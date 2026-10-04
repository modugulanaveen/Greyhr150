import { Router } from "express";
import { z } from "zod";
import { admin } from "../lib/supabase.js";
import { writeAudit } from "../lib/audit.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { canView, getMembership } from "../lib/authorization.js";
import {
  calculateMonthlyPayrollPreview,
  calculatePayrollRecord,
  calculateSalaryStructure,
  reconcilePayrollTotals,
  roundPayrollAmount,
  daysInMonth,
  type AttendanceSettings,
  type PfSettings,
  type PtSettings,
} from "@paymate/shared";
import { calculateEmployeeTds } from "./tds.js";

const router = Router();
router.use(requireAuth);
router.use(
  "/:id/calculate",
  rateLimit({ max: 20, keyPrefix: "payroll-calculate" }),
);
router.use("/:id/lock", rateLimit({ max: 20, keyPrefix: "payroll-lock" }));
router.use("/:id/reopen", rateLimit({ max: 20, keyPrefix: "payroll-reopen" }));
const uuid = z.string().uuid();
const period = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(1900).max(2200),
});
const adjustment = z.object({
  employee_id: uuid,
  adjustment_type: z.enum([
    "BONUS",
    "INCENTIVE",
    "REIMBURSEMENT",
    "OTHER_EARNINGS",
    "OTHER_DEDUCTION",
  ]).optional(),
  component_id: uuid.optional(),
  amount: z.coerce.number().positive(),
  reason: z.string().trim().min(2).max(500),
  notes: z.string().trim().max(1000).optional(),
  repeat_every_month: z.boolean().optional(),
}).refine((value) => Boolean(value.component_id || value.adjustment_type), {
  message: "Choose a payroll component",
  path: ["component_id"],
});
const adjustmentUpdate = z.object({
  amount: z.coerce.number().positive(),
  reason: z.string().trim().min(2).max(500),
  notes: z.string().trim().max(1000).optional(),
});
const reopenSchema = z.object({ reason: z.string().trim().min(3).max(1000) });
const payrollComponentSchema = z.object({
  name: z.string().trim().min(2).max(80),
  direction: z.enum(["EARNING", "DEDUCTION"]),
  is_taxable: z.boolean().optional(),
});
const payrollComponentUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  is_taxable: z.boolean().optional(),
  active: z.boolean().optional(),
}).strict();
const defaultPayrollComponents = [
  { name: "Bonus", direction: "EARNING", is_taxable: true },
  { name: "Incentive", direction: "EARNING", is_taxable: true },
  { name: "Reimbursement", direction: "EARNING", is_taxable: true },
  { name: "Conveyance", direction: "EARNING", is_taxable: true },
  { name: "Other Earnings", direction: "EARNING", is_taxable: true },
  { name: "Other Deduction", direction: "DEDUCTION", is_taxable: false },
  { name: "Advance Salary", direction: "DEDUCTION", is_taxable: false },
  { name: "Insurance", direction: "DEDUCTION", is_taxable: false },
] as const;

function fyForMonth(month: number, year: number) {
  return month >= 4
    ? `${year}-${String((year + 1) % 100).padStart(2, "0")}`
    : `${year - 1}-${String(year % 100).padStart(2, "0")}`;
}
function monthBounds(year: number, month: number) {
  return {
    start: `${year}-${String(month).padStart(2, "0")}-01`,
    end: `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth(year, month)).padStart(2, "0")}`,
  };
}
async function context(req: AuthRequest, companyId: string) {
  const m = await getMembership(req.userId!, companyId);
  return m && canView(m.role) ? m : null;
}
async function payrollComponents(companyId: string) {
  const seeds = defaultPayrollComponents.map((component) => ({
    company_id: companyId,
    ...component,
  }));
  const { error: seedError } = await admin
    .from("payroll_components")
    .upsert(seeds, {
      onConflict: "company_id,name,direction",
      ignoreDuplicates: true,
    });
  if (seedError) throw seedError;
  const { data, error } = await admin
    .from("payroll_components")
    .select("id,name,direction,is_taxable,active")
    .eq("company_id", companyId)
    .order("direction")
    .order("name");
  if (error) throw error;
  return data ?? [];
}
async function config(companyId: string) {
  const [a, p, t] = await Promise.all([
    admin
      .from("attendance_settings")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle(),
    admin
      .from("pf_settings")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle(),
    admin
      .from("pt_settings")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle(),
  ]);
  if (a.error || p.error || t.error) throw a.error || p.error || t.error;
  const attendance: AttendanceSettings = {
    prorationBasis:
      a.data?.proration_basis === "WORKING_DAYS"
        ? "WORKING_DAYS"
        : "CALENDAR_DAYS",
    weeklyOffDays: Array.isArray(a.data?.weekly_off_days)
      ? a.data.weekly_off_days
      : [0, 6],
    holidays: Array.isArray(a.data?.holidays) ? a.data.holidays : [],
    pfCalculationBasis:
      a.data?.pf_calculation_basis === "CONFIGURED_PF_WAGE"
        ? "CONFIGURED_PF_WAGE"
        : "ACTUAL_ADJUSTED_WAGES",
  };
  const pf: PfSettings = {
    enabled: p.data?.enabled !== false,
    employeePfRate: Number(p.data?.employee_pf_rate ?? 12),
    employerPfRate: Number(p.data?.employer_pf_rate ?? 12),
    pfWageCeiling: Number(p.data?.pf_wage_ceiling ?? 25000),
    minimumBasic: Number(p.data?.minimum_basic ?? 20000),
    basicPercentage: Number(p.data?.basic_percentage ?? 50),
  };
  const pt: PtSettings = {
    enabled: Boolean(t.data?.enabled),
    state: t.data?.state ?? null,
    slabs: Array.isArray(t.data?.slabs) ? t.data.slabs : [],
  };
  return { attendance, pf, pt };
}
async function employeesForPeriod(
  companyId: string,
  month: number,
  year: number,
) {
  const { start, end } = monthBounds(year, month);
  const { data, error } = await admin
    .from("employees")
    .select(
      "*,employee_bank_details(account_holder_name,bank_name,account_number,ifsc),employee_statutory_details(pan,uan,pf_member_id)",
    )
    .eq("company_id", companyId)
    .lte("date_of_joining", end)
    .or(`last_working_date.is.null,last_working_date.gte.${start}`)
    .in("employment_status", ["ACTIVE", "ON_NOTICE", "INACTIVE", "TERMINATED"])
    .order("employee_id");
  if (error) throw error;
  return data ?? [];
}
async function salaryFor(
  employeeId: string,
  companyId: string,
  month: number,
  year: number,
  cfg: Awaited<ReturnType<typeof config>>,
) {
  const { start, end } = monthBounds(year, month);
  const { data: assignment, error: assignmentError } = await admin
    .from("employee_salary_assignments")
    .select(
      "employee_id,annual_ctc,effective_from,pf_applicable,pt_applicable,tds_applicable",
    )
    .eq("company_id", companyId)
    .eq("employee_id", employeeId)
    .lte("effective_from", end)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (assignmentError) throw assignmentError;
  if (assignment && Number(assignment.annual_ctc) > 0) {
    const calculated = calculateSalaryStructure({ annualCtc: Number(assignment.annual_ctc), pfSettings: cfg.pf, ptSettings: cfg.pt });
    return {
      ...assignment,
      monthly_ctc: calculated.monthlyCtc,
      basic_salary: calculated.basicSalary,
      special_allowance: calculated.specialAllowance,
      gross_salary: calculated.grossSalary,
      employee_pf: calculated.employeePf,
      employer_pf: calculated.employerPf,
      professional_tax: calculated.professionalTax,
    };
  }
  const { data, error } = await admin
    .from("salary_structures")
    .select("*")
    .eq("company_id", companyId)
    .eq("employee_id", employeeId)
    .lte("effective_from", end)
    .or(`effective_to.is.null,effective_to.gte.${start}`)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}
async function attendanceFor(
  employeeId: string,
  companyId: string,
  month: number,
  year: number,
) {
  const { data, error } = await admin
    .from("attendance_records")
    .select("*")
    .eq("company_id", companyId)
    .eq("employee_id", employeeId)
    .eq("payroll_month", month)
    .eq("payroll_year", year)
    .maybeSingle();
  if (error) throw error;
  return data;
}
async function adjustmentsFor(
  runId: string,
  employeeId: string,
  companyId: string,
) {
  const { data, error } = await admin
    .from("payroll_adjustments")
    .select("adjustment_type,component_type,amount")
    .eq("company_id", companyId)
    .eq("payroll_run_id", runId)
    .eq("employee_id", employeeId)
    .eq("voided", false);
  if (error) throw error;
  return (data ?? []).reduce(
    (a: any, r: any) => {
      const amount = Number(r.amount);
      const direction =
        r.component_type ??
        (r.adjustment_type === "OTHER_DEDUCTION" ? "DEDUCTION" : "EARNING");
      if (direction === "DEDUCTION") a.deductions += amount;
      else a.earnings += amount;
      return a;
    },
    { earnings: 0, deductions: 0 },
  );
}
async function refreshAdjustmentTaxability(runId: string, companyId: string) {
  const { data: adjustments, error } = await admin
    .from("payroll_adjustments")
    .select("id,component_id,component_type")
    .eq("company_id", companyId)
    .eq("payroll_run_id", runId)
    .eq("voided", false)
    .not("component_id", "is", null);
  if (error) throw error;
  const componentIds = [...new Set((adjustments ?? []).map((row: any) => row.component_id))];
  if (!componentIds.length) return;
  const { data: components, error: componentError } = await admin
    .from("payroll_components")
    .select("id,is_taxable")
    .eq("company_id", companyId)
    .in("id", componentIds);
  if (componentError) throw componentError;
  const taxableById = new Map((components ?? []).map((item: any) => [item.id, item.is_taxable]));
  for (const row of adjustments ?? []) {
    const isTaxable = row.component_type === "EARNING" && taxableById.get(row.component_id) === true;
    const { error: updateError } = await admin
      .from("payroll_adjustments")
      .update({ component_taxable: isTaxable })
      .eq("company_id", companyId)
      .eq("id", row.id);
    if (updateError) throw updateError;
  }
}
async function applyRecurringAdjustments(
  runId: string,
  companyId: string,
  month: number,
  year: number,
  employees: any[],
) {
  if (!employees.length) return;
  const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const { data: recurring, error } = await admin
    .from("employee_recurring_payroll_components")
    .select("*,payroll_components(name,direction,is_taxable)")
    .eq("company_id", companyId)
    .eq("active", true)
    .in("employee_id", employees.map((employee) => employee.id))
    .lte("starts_month", periodStart)
    .or(`ends_month.is.null,ends_month.gte.${periodStart}`);
  if (error) throw error;
  if (!recurring?.length) return;

  const { data: existing, error: existingError } = await admin
    .from("payroll_adjustments")
    .select("recurring_component_id")
    .eq("company_id", companyId)
    .eq("payroll_run_id", runId)
    .not("recurring_component_id", "is", null);
  if (existingError) throw existingError;
  const alreadyApplied = new Set(
    (existing ?? []).map((adjustment: any) => adjustment.recurring_component_id),
  );
  for (const item of recurring) {
    if (alreadyApplied.has(item.id)) continue;
    const component = Array.isArray(item.payroll_components)
      ? item.payroll_components[0]
      : item.payroll_components;
    if (!component) continue;
    const direction = component.direction;
    const { error: insertError } = await admin.from("payroll_adjustments").insert({
      company_id: companyId,
      payroll_run_id: runId,
      employee_id: item.employee_id,
      adjustment_type: direction === "DEDUCTION" ? "OTHER_DEDUCTION" : "OTHER_EARNINGS",
      amount: item.amount,
      reason: item.reason,
      notes: item.notes,
      component_id: item.component_id,
      component_name: component.name,
      component_type: direction,
      component_taxable: direction === "EARNING" && component.is_taxable === true,
      recurring_component_id: item.id,
      created_by: item.created_by,
    });
    if (insertError && insertError.code !== "23505") throw insertError;
    alreadyApplied.add(item.id);
  }
}
function eligibilityError(e: any) {
  return e instanceof Error ? e.message : "Unable to calculate payroll";
}
async function calculateRun(
  companyId: string,
  runId: string,
  month: number,
  year: number,
  userId: string,
) {
  const cfg = await config(companyId);
  const employees = await employeesForPeriod(companyId, month, year);
  await applyRecurringAdjustments(runId, companyId, month, year, employees);
  await refreshAdjustmentTaxability(runId, companyId);
  const validations: any[] = [];
  const results: any[] = [];
  await admin
    .from("payroll_validation_errors")
    .delete()
    .eq("company_id", companyId)
    .eq("payroll_run_id", runId);
  for (const e of employees) {
    const storedSalary = await salaryFor(e.id, companyId, month, year, cfg);
    const attendance = await attendanceFor(e.id, companyId, month, year);
    const bank = Array.isArray(e.employee_bank_details)
      ? e.employee_bank_details[0]
      : e.employee_bank_details;
    const stat = Array.isArray(e.employee_statutory_details)
      ? e.employee_statutory_details[0]
      : e.employee_statutory_details;
    if (!storedSalary) {
      validations.push({
        employee_id: e.id,
        severity: "ERROR",
        code: "MISSING_SALARY",
        message: `Employee ${e.employee_id} has no annual CTC effective for ${month}/${year}. Add the annual CTC in the employee profile.`,
      });
      continue;
    }
    const employeePfSettings: PfSettings = {
      ...cfg.pf,
      enabled: cfg.pf.enabled !== false && storedSalary.pf_applicable !== false,
    };
    const employeePtSettings: PtSettings = {
      ...cfg.pt,
      enabled: cfg.pt.enabled && storedSalary.pt_applicable !== false,
    };
    const currentSalary = calculateSalaryStructure({
      annualCtc: Number(storedSalary.annual_ctc),
      pfSettings: employeePfSettings,
      ptSettings: employeePtSettings,
    });
    const salary = {
      ...storedSalary,
      monthly_ctc: currentSalary.monthlyCtc,
      basic_salary: currentSalary.basicSalary,
      special_allowance: currentSalary.specialAllowance,
      gross_salary: currentSalary.grossSalary,
      employee_pf: currentSalary.employeePf,
      employer_pf: currentSalary.employerPf,
      professional_tax: currentSalary.professionalTax,
    };
    if (!attendance) {
      validations.push({
        employee_id: e.id,
        severity: "ERROR",
        code: "MISSING_ATTENDANCE",
        message: `Employee ${e.employee_id} has no attendance record for ${month}/${year}.`,
      });
      continue;
    }
    if (!bank?.account_number) {
      validations.push({
        employee_id: e.id,
        severity: "WARNING",
        code: "MISSING_BANK",
        message: `Employee ${e.employee_id} has no bank account details.`,
      });
    }
    if (employeePfSettings.enabled && !stat?.uan && !stat?.pf_member_id) {
      validations.push({
        employee_id: e.id,
        severity: "WARNING",
        code: "MISSING_UAN",
        message: `Employee ${e.employee_id} has no UAN or PF member ID.`,
      });
    }
    const fy = fyForMonth(month, year);
    let tds = 0;
    if (storedSalary.tds_applicable !== false) {
      try {
        const result = await calculateEmployeeTds(
          companyId,
          e.id,
          fy,
          month,
        );
        tds = Number(result.currentMonthTds ?? 0);
      } catch (error) {
        validations.push({
          employee_id: e.id,
          severity: "ERROR",
          code: "TDS_CALCULATION_FAILED",
          message: `Unable to calculate TDS for ${e.employee_id}: ${eligibilityError(error)}`,
        });
        continue;
      }
    }
    try {
      const preview = calculateMonthlyPayrollPreview({
        salaryStructure: salary,
        payrollMonth: month,
        payrollYear: year,
        joiningDate: e.date_of_joining,
        lopDays: Number(attendance.lop_days),
        presentDays: Number(attendance.present_days),
        paidLeaveDays: Number(attendance.paid_leave_days),
        attendanceSettings: cfg.attendance,
        pfSettings: employeePfSettings,
        ptSettings: employeePtSettings,
      });
      const adj = await adjustmentsFor(runId, e.id, companyId);
      const calc = calculatePayrollRecord({
        attendance: preview,
        tds,
        adjustments: adj,
      });
      results.push({
        employee: e,
        salary,
        attendance,
        preview,
        tds,
        calculation: calc,
        adjustments: adj,
      });
    } catch (err) {
      validations.push({
        employee_id: e.id,
        severity: "ERROR",
        code: "CALCULATION_ERROR",
        message: `${e.employee_id}: ${eligibilityError(err)}`,
      });
    }
  }
  const validationRows = validations.map((v) => ({
    company_id: companyId,
    payroll_run_id: runId,
    ...v,
  }));
  if (validationRows.length) {
    const { error } = await admin
      .from("payroll_validation_errors")
      .insert(validationRows);
    if (error) throw error;
  }
  const totals = results.reduce(
    (a, r) => {
      const c = r.calculation;
      a.employeeCount++;
      a.gross += c.adjustedGross;
      a.employeePf += c.employeePf;
      a.employerPf += c.employerPf;
      a.pt += c.professionalTax;
      a.tds += c.tds;
      a.otherDeductions += c.otherDeductions;
      a.deductions += c.totalDeductions;
      a.net += c.netSalary;
      a.employerCost += c.employerCost;
      a.adjustmentEarnings += c.adjustmentEarnings;
      a.adjustmentDeductions += c.adjustmentDeductions;
      return a;
    },
    {
      employeeCount: 0,
      gross: 0,
      employeePf: 0,
      employerPf: 0,
      pt: 0,
      tds: 0,
      otherDeductions: 0,
      deductions: 0,
      net: 0,
      employerCost: 0,
      adjustmentEarnings: 0,
      adjustmentDeductions: 0,
    },
  );
  const rec = reconcilePayrollTotals(totals);
  if (!rec.netMatches || !rec.employerCostMatches) {
    validations.push({
      severity: "ERROR",
      code: "RECONCILIATION_MISMATCH",
      message: "Payroll totals do not reconcile.",
    });
    await admin
      .from("payroll_validation_errors")
      .insert({
        company_id: companyId,
        payroll_run_id: runId,
        severity: "ERROR",
        code: "RECONCILIATION_MISMATCH",
        message: "Payroll totals do not reconcile.",
      });
  }
  await admin
    .from("payroll_records")
    .delete()
    .eq("company_id", companyId)
    .eq("payroll_run_id", runId);
  if (results.length) {
    const rows = results.map((r) => {
      const c = r.calculation;
      return {
        company_id: companyId,
        payroll_run_id: runId,
        employee_id: r.employee.id,
        salary_structure_id: r.salary.id,
        attendance_record_id: r.attendance.id,
        paid_days: r.preview.paidDays,
        basic_salary: c.basicSalary,
        special_allowance: c.specialAllowance,
        gross_salary: c.grossSalary,
        lop_days: r.preview.lopDays,
        lop_deduction: c.lopDeduction,
        adjusted_gross: c.adjustedGross,
        employee_pf: c.employeePf,
        employer_pf: c.employerPf,
        professional_tax: c.professionalTax,
        tds: c.tds,
        adjustment_earnings: c.adjustmentEarnings,
        adjustment_deductions: c.adjustmentDeductions,
        other_deductions: c.otherDeductions,
        total_deductions: c.totalDeductions,
        net_salary: c.netSalary,
        employer_cost: c.employerCost,
        status: "CALCULATED",
      };
    });
    const { error } = await admin.from("payroll_records").insert(rows);
    if (error) throw error;
  }
  const status =
    validations.some((v) => v.severity === "ERROR") ||
    !rec.netMatches ||
    !rec.employerCostMatches
      ? "CALCULATED"
      : "CALCULATED";
  const { data: run, error: runError } = await admin
    .from("payroll_runs")
    .update({
      status,
      employee_count: totals.employeeCount,
      gross_total: roundPayrollAmount(totals.gross),
      employee_pf_total: roundPayrollAmount(totals.employeePf),
      employer_pf_total: roundPayrollAmount(totals.employerPf),
      pt_total: roundPayrollAmount(totals.pt),
      tds_total: roundPayrollAmount(totals.tds),
      deduction_total: roundPayrollAmount(totals.deductions),
      net_salary_total: roundPayrollAmount(totals.net),
      employer_cost_total: roundPayrollAmount(totals.employerCost),
      adjustment_earnings_total: roundPayrollAmount(totals.adjustmentEarnings),
      adjustment_deductions_total: roundPayrollAmount(
        totals.adjustmentDeductions,
      ),
    })
    .eq("company_id", companyId)
    .eq("id", runId)
    .select("*")
    .single();
  if (runError) throw runError;
  await admin
    .from("payroll_audit_logs")
    .insert({
      company_id: companyId,
      payroll_run_id: runId,
      user_id: userId,
      action: "PAYROLL_CALCULATED",
      metadata: {
        validationCount: validations.length,
        employeeCount: totals.employeeCount,
      },
    });
  return { run, results, validations, reconciliation: rec };
}

router.get("/components", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    if (!(await context(req, companyId)))
      return res.status(403).json({ error: "Company access denied" });
    res.json({ components: await payrollComponents(companyId) });
  } catch (e) {
    const dbError = e as { code?: string; message?: string };
    res.status(400).json({
      error:
        dbError?.code === "42P01" || dbError?.code === "PGRST205"
          ? "Payroll components are not installed in the database. Apply the latest Supabase migrations, then try again."
          : dbError?.message || "Unable to load payroll components",
    });
  }
});
router.post("/components", async (req: AuthRequest, res) => {
  const parsed = payrollComponentSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Invalid payroll component" });
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await context(req, companyId);
    if (!m || !["OWNER", "COMPANY_ADMIN", "HR"].includes(m.role))
      return res.status(403).json({ error: "Insufficient permissions" });
    const { data: duplicate, error: duplicateError } = await admin
      .from("payroll_components")
      .select("id")
      .eq("company_id", companyId)
      .eq("direction", parsed.data.direction)
      .ilike("name", parsed.data.name)
      .maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate)
      return res.status(409).json({ error: "This payroll component already exists" });
    const { data, error } = await admin
      .from("payroll_components")
      .insert({
        company_id: companyId,
        ...parsed.data,
        is_taxable: parsed.data.direction === "EARNING" && parsed.data.is_taxable !== false,
      })
      .select("id,name,direction,is_taxable,active")
      .single();
    if (error) throw error;
    await writeAudit(companyId, req.userId!, "PAYROLL_COMPONENT_CREATED", "PAYROLL_COMPONENT", data.id, data);
    res.status(201).json({ component: data });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Unable to save payroll component" });
  }
});
router.patch("/components/:componentId", async (req: AuthRequest, res) => {
  const parsed = payrollComponentUpdateSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Invalid payroll component changes" });
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const componentId = uuid.parse(req.params.componentId);
    const m = await context(req, companyId);
    if (!m || !["OWNER", "COMPANY_ADMIN", "HR"].includes(m.role))
      return res.status(403).json({ error: "Insufficient permissions" });
    const { data: current, error: lookupError } = await admin
      .from("payroll_components")
      .select("direction")
      .eq("company_id", companyId)
      .eq("id", componentId)
      .single();
    if (lookupError) throw lookupError;
    const changes = {
      ...parsed.data,
      ...(parsed.data.is_taxable !== undefined
        ? { is_taxable: current.direction === "EARNING" && parsed.data.is_taxable }
        : {}),
    };
    const { data, error } = await admin
      .from("payroll_components")
      .update(changes)
      .eq("company_id", companyId)
      .eq("id", componentId)
      .select("id,name,direction,is_taxable,active")
      .single();
    if (error) throw error;
    await writeAudit(companyId, req.userId!, "PAYROLL_COMPONENT_UPDATED", "PAYROLL_COMPONENT", componentId, changes);
    res.json({ component: data });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Unable to update payroll component" });
  }
});

router.post("/", async (req: AuthRequest, res) => {
  const p = period.safeParse(req.body);
  if (!p.success)
    return res.status(400).json({ error: "Invalid payroll period" });
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await context(req, companyId);
    if (!m) return res.status(403).json({ error: "Company access denied" });
    const current = new Date();
    const selectedKey = p.data.year * 12 + p.data.month;
    const currentKey = current.getFullYear() * 12 + (current.getMonth() + 1);
    const { data: paySetting } = await admin
      .from("payroll_settings")
      .select("allow_future_payroll")
      .eq("company_id", companyId)
      .maybeSingle();
    if (selectedKey > currentKey && !paySetting?.allow_future_payroll)
      return res
        .status(422)
        .json({
          error: "Future payroll processing is disabled for this company.",
        });
    const existing = await admin
      .from("payroll_runs")
      .select("*")
      .eq("company_id", companyId)
      .eq("payroll_month", p.data.month)
      .eq("payroll_year", p.data.year)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data)
      return res
        .status(409)
        .json({
          error: `Payroll already exists for ${p.data.month}/${p.data.year}`,
          payroll: existing.data,
        });
    const { data, error } = await admin
      .from("payroll_runs")
      .insert({
        company_id: companyId,
        payroll_month: p.data.month,
        payroll_year: p.data.year,
        status: "DRAFT",
        created_by: req.userId,
      })
      .select("*")
      .single();
    if (error) throw error;
    await admin
      .from("payroll_audit_logs")
      .insert({
        company_id: companyId,
        payroll_run_id: data.id,
        user_id: req.userId,
        action: "PAYROLL_CREATED",
        new_status: "DRAFT",
      });
    await writeAudit(
      companyId,
      req.userId!,
      "PAYROLL_CREATED",
      "PAYROLL_RUN",
      data.id,
      {
        status: "DRAFT",
        payroll_month: p.data.month,
        payroll_year: p.data.year,
      },
    );
    res.status(201).json({ payroll: data });
  } catch (e) {
    res.status(400).json({ error: eligibilityError(e) });
  }
});
router.get("/history", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await context(req, companyId);
    if (!m) return res.status(403).json({ error: "Company access denied" });
    const { data, error } = await admin
      .from("payroll_runs")
      .select("*")
      .eq("company_id", companyId)
      .order("payroll_year", { ascending: false })
      .order("payroll_month", { ascending: false });
    if (error) throw error;
    res.json({ runs: data ?? [] });
  } catch (e) {
    res.status(400).json({ error: eligibilityError(e) });
  }
});
router.get("/:id", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id)),
      id = uuid.parse(req.params.id);
    const m = await context(req, companyId);
    if (!m) return res.status(403).json({ error: "Company access denied" });
    const { data: run, error } = await admin
      .from("payroll_runs")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", id)
      .single();
    if (error || !run)
      return res.status(404).json({ error: "Payroll not found" });
    const [{ data: records }, { data: validation }] = await Promise.all([
      admin
        .from("payroll_records")
        .select(
          "*, employees(employee_id,first_name,last_name,date_of_joining,employment_status)",
        )
        .eq("company_id", companyId)
        .eq("payroll_run_id", id)
        .order("employee_id"),
      admin
        .from("payroll_validation_errors")
        .select("*")
        .eq("company_id", companyId)
        .eq("payroll_run_id", id)
        .order("severity"),
    ]);
    res.json({ run, records: records ?? [], validation: validation ?? [] });
  } catch (e) {
    res.status(400).json({ error: eligibilityError(e) });
  }
});
router.post("/:id/calculate", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id)),
      id = uuid.parse(req.params.id);
    const m = await context(req, companyId);
    if (!m) return res.status(403).json({ error: "Company access denied" });
    const { data: run } = await admin
      .from("payroll_runs")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", id)
      .single();
    if (!run) return res.status(404).json({ error: "Payroll not found" });
    if (["APPROVED", "LOCKED"].includes(run.status))
      return res
        .status(409)
        .json({ error: "Approved or locked payroll cannot be recalculated" });
    await admin
      .from("payroll_runs")
      .update({ status: "CALCULATING" })
      .eq("company_id", companyId)
      .eq("id", id);
    const calculated = await calculateRun(
      companyId,
      id,
      run.payroll_month,
      run.payroll_year,
      req.userId!,
    );
    await writeAudit(
      companyId,
      req.userId!,
      "PAYROLL_CALCULATED",
      "PAYROLL_RUN",
      id,
      { payroll_month: run.payroll_month, payroll_year: run.payroll_year },
    );
    res.json(calculated);
  } catch (e) {
    res.status(400).json({ error: eligibilityError(e) });
  }
});
router.post("/:id/review", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id)),
      id = uuid.parse(req.params.id);
    const m = await context(req, companyId);
    if (!m || !["OWNER", "COMPANY_ADMIN", "HR", "ACCOUNTANT"].includes(m.role))
      return res.status(403).json({ error: "Insufficient permissions" });
    const { data: run } = await admin
      .from("payroll_runs")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", id)
      .single();
    if (!run) return res.status(404).json({ error: "Payroll not found" });
    if (run.status !== "CALCULATED")
      return res
        .status(409)
        .json({ error: "Payroll must be calculated before review" });
    const { data: errors } = await admin
      .from("payroll_validation_errors")
      .select("id")
      .eq("company_id", companyId)
      .eq("payroll_run_id", id)
      .eq("severity", "ERROR")
      .eq("acknowledged", false);
    if ((errors ?? []).length)
      return res
        .status(422)
        .json({
          error: "Resolve payroll errors before review",
          count: errors?.length,
        });
    await admin
      .from("payroll_runs")
      .update({ status: "UNDER_REVIEW" })
      .eq("company_id", companyId)
      .eq("id", id);
    await writeAudit(
      companyId,
      req.userId!,
      "PAYROLL_SUBMITTED_REVIEW",
      "PAYROLL_RUN",
      id,
      { previous_status: run.status, new_status: "UNDER_REVIEW" },
    );
    await admin
      .from("payroll_audit_logs")
      .insert({
        company_id: companyId,
        payroll_run_id: id,
        user_id: req.userId,
        action: "PAYROLL_SUBMITTED_REVIEW",
        previous_status: run.status,
        new_status: "UNDER_REVIEW",
      });
    res.json({ message: "Payroll moved to review" });
  } catch (e) {
    res.status(400).json({ error: eligibilityError(e) });
  }
});
router.post("/:id/approve", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id)),
      id = uuid.parse(req.params.id);
    const m = await context(req, companyId);
    if (!m || !["OWNER", "COMPANY_ADMIN", "ACCOUNTANT"].includes(m.role))
      return res.status(403).json({ error: "Approval permission required" });
    const { data: run } = await admin
      .from("payroll_runs")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", id)
      .single();
    if (!run) return res.status(404).json({ error: "Payroll not found" });
    if (run.status !== "UNDER_REVIEW")
      return res
        .status(409)
        .json({ error: "Payroll must be under review before approval" });
    const { data: errors } = await admin
      .from("payroll_validation_errors")
      .select("id")
      .eq("company_id", companyId)
      .eq("payroll_run_id", id)
      .eq("severity", "ERROR");
    if ((errors ?? []).length)
      return res
        .status(422)
        .json({
          error: "Payroll has unresolved errors",
          count: errors?.length,
        });
    const { data: updated, error } = await admin
      .from("payroll_runs")
      .update({
        status: "APPROVED",
        approved_by: req.userId,
        approved_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    await admin
      .from("payroll_records")
      .update({ status: "APPROVED" })
      .eq("company_id", companyId)
      .eq("payroll_run_id", id);
    await admin
      .from("payroll_audit_logs")
      .insert({
        company_id: companyId,
        payroll_run_id: id,
        user_id: req.userId,
        action: "PAYROLL_APPROVED",
        previous_status: run.status,
        new_status: "APPROVED",
      });
    await writeAudit(
      companyId,
      req.userId!,
      "PAYROLL_APPROVED",
      "PAYROLL_RUN",
      id,
      { previous_status: run.status, new_status: "APPROVED" },
    );
    res.json({ payroll: updated });
  } catch (e) {
    res.status(400).json({ error: eligibilityError(e) });
  }
});
router.post("/:id/lock", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id)),
      id = uuid.parse(req.params.id);
    const m = await context(req, companyId);
    if (!m || !["OWNER", "COMPANY_ADMIN"].includes(m.role))
      return res
        .status(403)
        .json({ error: "Only administrators can lock payroll" });
    const { data: run } = await admin
      .from("payroll_runs")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", id)
      .single();
    if (!run) return res.status(404).json({ error: "Payroll not found" });
    if (run.status !== "APPROVED")
      return res
        .status(409)
        .json({ error: "Only approved payroll can be locked" });
    const { data: updated, error } = await admin
      .from("payroll_runs")
      .update({
        status: "LOCKED",
        locked_by: req.userId,
        locked_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    await admin
      .from("payroll_records")
      .update({ status: "LOCKED" })
      .eq("company_id", companyId)
      .eq("payroll_run_id", id);
    await admin
      .from("payroll_audit_logs")
      .insert({
        company_id: companyId,
        payroll_run_id: id,
        user_id: req.userId,
        action: "PAYROLL_LOCKED",
        previous_status: run.status,
        new_status: "LOCKED",
      });
    await writeAudit(
      companyId,
      req.userId!,
      "PAYROLL_LOCKED",
      "PAYROLL_RUN",
      id,
      { previous_status: run.status, new_status: "LOCKED" },
    );
    res.json({ payroll: updated });
  } catch (e) {
    res.status(400).json({ error: eligibilityError(e) });
  }
});
router.post("/:id/reopen", async (req: AuthRequest, res) => {
  const body = reopenSchema.safeParse(req.body);
  if (!body.success)
    return res.status(400).json({ error: "A reopening reason is required" });
  try {
    const companyId = uuid.parse(String(req.query.company_id)),
      id = uuid.parse(req.params.id);
    const m = await context(req, companyId);
    if (!m || !["OWNER", "COMPANY_ADMIN"].includes(m.role))
      return res
        .status(403)
        .json({ error: "Only administrators can reopen payroll" });
    const { data: run } = await admin
      .from("payroll_runs")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", id)
      .single();
    if (!run || run.status !== "LOCKED")
      return res
        .status(409)
        .json({ error: "Only locked payroll can be reopened" });
    const { data: updated, error } = await admin
      .from("payroll_runs")
      .update({
        status: "DRAFT",
        approved_by: null,
        approved_at: null,
        locked_by: null,
        locked_at: null,
      })
      .eq("company_id", companyId)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    await admin
      .from("payroll_records")
      .update({ status: "CALCULATED" })
      .eq("company_id", companyId)
      .eq("payroll_run_id", id);
    await admin
      .from("payroll_audit_logs")
      .insert({
        company_id: companyId,
        payroll_run_id: id,
        user_id: req.userId,
        action: "PAYROLL_REOPENED",
        previous_status: "LOCKED",
        new_status: "DRAFT",
        reason: body.data.reason,
      });
    await writeAudit(
      companyId,
      req.userId!,
      "PAYROLL_REOPENED",
      "PAYROLL_RUN",
      id,
      {
        previous_status: "LOCKED",
        new_status: "DRAFT",
        reason: body.data.reason,
      },
    );
    res.json({ payroll: updated });
  } catch (e) {
    res.status(400).json({ error: eligibilityError(e) });
  }
});
router.post("/:id/adjustments", async (req: AuthRequest, res) => {
  const body = adjustment.safeParse(req.body);
  if (!body.success)
    return res
      .status(400)
      .json({
        error: "Invalid payroll adjustment",
        details: body.error.flatten().fieldErrors,
      });
  try {
    const companyId = uuid.parse(String(req.query.company_id)),
      id = uuid.parse(req.params.id);
    const m = await context(req, companyId);
    if (!m || !["OWNER", "COMPANY_ADMIN", "HR", "ACCOUNTANT"].includes(m.role))
      return res.status(403).json({ error: "Insufficient permissions" });
    const { data: run } = await admin
      .from("payroll_runs")
      .select("status,payroll_month,payroll_year")
      .eq("company_id", companyId)
      .eq("id", id)
      .single();
    if (!run || ["APPROVED", "LOCKED"].includes(run.status))
      return res.status(409).json({ error: "Payroll adjustments are closed" });
    if (body.data.repeat_every_month && !body.data.component_id)
      return res.status(400).json({ error: "Recurring items need a payroll component" });
    let component: any = null;
    if (body.data.component_id) {
      const { data, error } = await admin
        .from("payroll_components")
        .select("id,name,direction,is_taxable,active")
        .eq("company_id", companyId)
        .eq("id", body.data.component_id)
        .single();
      if (error) throw error;
      if (!data.active)
        return res.status(409).json({ error: "This payroll component is inactive" });
      component = data;
    }
    let recurringId: string | null = null;
    if (body.data.repeat_every_month && component) {
      const { data: recurring, error: recurringError } = await admin
        .from("employee_recurring_payroll_components")
        .insert({
          company_id: companyId,
          employee_id: body.data.employee_id,
          component_id: component.id,
          amount: body.data.amount,
          reason: body.data.reason,
          notes: body.data.notes ?? null,
          starts_month: `${run.payroll_year}-${String(run.payroll_month).padStart(2, "0")}-01`,
          created_by: req.userId,
        })
        .select("id")
        .single();
      if (recurringError) throw recurringError;
      recurringId = recurring.id;
    }
    const componentType =
      component?.direction ??
      (body.data.adjustment_type === "OTHER_DEDUCTION" ? "DEDUCTION" : "EARNING");
    const adjustmentType = component
      ? componentType === "DEDUCTION"
        ? "OTHER_DEDUCTION"
        : "OTHER_EARNINGS"
      : body.data.adjustment_type!;
    const { data, error } = await admin
      .from("payroll_adjustments")
      .insert({
        company_id: companyId,
        payroll_run_id: id,
        employee_id: body.data.employee_id,
        adjustment_type: adjustmentType,
        amount: body.data.amount,
        reason: body.data.reason,
        notes: body.data.notes,
        component_id: component?.id ?? null,
        component_name: component?.name ?? null,
        component_type: componentType,
        component_taxable:
          componentType === "EARNING"
            ? component?.is_taxable ?? true
            : false,
        recurring_component_id: recurringId,
        created_by: req.userId,
      })
      .select("*")
      .single();
    if (error) {
      if (recurringId)
        await admin
          .from("employee_recurring_payroll_components")
          .delete()
          .eq("company_id", companyId)
          .eq("id", recurringId);
      throw error;
    }
    await admin
      .from("payroll_runs")
      .update({ status: "CALCULATING" })
      .eq("company_id", companyId)
      .eq("id", id);
    await calculateRun(
      companyId,
      id,
      run.payroll_month,
      run.payroll_year,
      req.userId!,
    );
    res.status(201).json({ adjustment: data });
  } catch (e) {
    res.status(400).json({ error: eligibilityError(e) });
  }
});
router.put(
  "/:id/adjustments/:adjustmentId",
  async (req: AuthRequest, res) => {
    const body = adjustmentUpdate.safeParse(req.body);
    if (!body.success)
      return res.status(400).json({ error: "Invalid payroll adjustment changes" });
    try {
      const companyId = uuid.parse(String(req.query.company_id));
      const id = uuid.parse(req.params.id);
      const adjustmentId = uuid.parse(req.params.adjustmentId);
      const m = await context(req, companyId);
      if (!m || !["OWNER", "COMPANY_ADMIN", "HR", "ACCOUNTANT"].includes(m.role))
        return res.status(403).json({ error: "Insufficient permissions" });
      const { data: run } = await admin
        .from("payroll_runs")
        .select("status,payroll_month,payroll_year")
        .eq("company_id", companyId)
        .eq("id", id)
        .single();
      if (!run || ["APPROVED", "LOCKED"].includes(run.status))
        return res.status(409).json({ error: "Payroll adjustments are closed" });
      const { data: updated, error } = await admin
        .from("payroll_adjustments")
        .update(body.data)
        .eq("company_id", companyId)
        .eq("payroll_run_id", id)
        .eq("id", adjustmentId)
        .eq("voided", false)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!updated) return res.status(404).json({ error: "Payroll adjustment not found" });
      await admin
        .from("payroll_runs")
        .update({ status: "CALCULATING" })
        .eq("company_id", companyId)
        .eq("id", id);
      await calculateRun(companyId, id, run.payroll_month, run.payroll_year, req.userId!);
      res.json({ adjustment: updated });
    } catch (e) {
      res.status(400).json({ error: eligibilityError(e) });
    }
  },
);
router.patch(
  "/recurring-components/:recurringId/stop",
  async (req: AuthRequest, res) => {
    try {
      const companyId = uuid.parse(String(req.query.company_id));
      const recurringId = uuid.parse(req.params.recurringId);
      const m = await context(req, companyId);
      if (!m || !["OWNER", "COMPANY_ADMIN", "HR", "ACCOUNTANT"].includes(m.role))
        return res.status(403).json({ error: "Insufficient permissions" });
      const { data, error } = await admin
        .from("employee_recurring_payroll_components")
        .update({ active: false })
        .eq("company_id", companyId)
        .eq("id", recurringId)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: "Recurring component not found" });
      res.json({ message: "Future monthly repeats stopped" });
    } catch (e) {
      res.status(400).json({ error: eligibilityError(e) });
    }
  },
);
router.delete(
  "/:id/adjustments/:adjustmentId",
  async (req: AuthRequest, res) => {
    try {
      const companyId = uuid.parse(String(req.query.company_id)),
        id = uuid.parse(req.params.id),
        adjustmentId = uuid.parse(req.params.adjustmentId);
      const m = await context(req, companyId);
      if (
        !m ||
        !["OWNER", "COMPANY_ADMIN", "HR", "ACCOUNTANT"].includes(m.role)
      )
        return res.status(403).json({ error: "Insufficient permissions" });
      const { data: run } = await admin
        .from("payroll_runs")
        .select("status,payroll_month,payroll_year")
        .eq("company_id", companyId)
        .eq("id", id)
        .single();
      if (!run || ["APPROVED", "LOCKED"].includes(run.status))
        return res
          .status(409)
          .json({ error: "Payroll adjustments are closed" });
      const { data: existing, error: lookupError } = await admin
        .from("payroll_adjustments")
        .select("recurring_component_id")
        .eq("company_id", companyId)
        .eq("payroll_run_id", id)
        .eq("id", adjustmentId)
        .eq("voided", false)
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (!existing) return res.status(404).json({ error: "Payroll adjustment not found" });
      const deletion = existing.recurring_component_id
        ? await admin
            .from("payroll_adjustments")
            .update({ voided: true })
            .eq("company_id", companyId)
            .eq("payroll_run_id", id)
            .eq("id", adjustmentId)
        : await admin
            .from("payroll_adjustments")
            .delete()
            .eq("company_id", companyId)
            .eq("payroll_run_id", id)
            .eq("id", adjustmentId);
      if (deletion.error) throw deletion.error;
      await admin
        .from("payroll_runs")
        .update({ status: "CALCULATING" })
        .eq("company_id", companyId)
        .eq("id", id);
      await calculateRun(
        companyId,
        id,
        run.payroll_month,
        run.payroll_year,
        req.userId!,
      );
      res.json({ message: "Adjustment removed" });
    } catch (e) {
      res.status(400).json({ error: eligibilityError(e) });
    }
  },
);
router.get("/:id/employee/:employeeId", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id)),
      id = uuid.parse(req.params.id),
      employeeId = uuid.parse(req.params.employeeId);
    const m = await context(req, companyId);
    if (!m) return res.status(403).json({ error: "Company access denied" });
    const [{ data: run }, { data: record }] = await Promise.all([
      admin
        .from("payroll_runs")
        .select("*")
        .eq("company_id", companyId)
        .eq("id", id)
        .single(),
      admin
        .from("payroll_records")
        .select("*, employees(*)")
        .eq("company_id", companyId)
        .eq("payroll_run_id", id)
        .eq("employee_id", employeeId)
        .single(),
    ]);
    if (!run || !record)
      return res
        .status(404)
        .json({ error: "Payroll employee record not found" });
    const [{ data: salary }, { data: attendance }, { data: adjustments }] =
      await Promise.all([
        admin
          .from("salary_structures")
          .select("*")
          .eq("company_id", companyId)
          .eq("id", record.salary_structure_id)
          .maybeSingle(),
        admin
          .from("attendance_records")
          .select("*")
          .eq("company_id", companyId)
          .eq("id", record.attendance_record_id)
          .maybeSingle(),
        admin
        .from("payroll_adjustments")
        .select("*")
        .eq("company_id", companyId)
        .eq("payroll_run_id", id)
        .eq("employee_id", employeeId)
        .eq("voided", false),
      ]);
    const recurringIds: string[] = [...new Set<string>(
      (adjustments ?? [])
        .map((item: any) => item.recurring_component_id)
        .filter((value: unknown): value is string => typeof value === "string"),
    )];
    const { data: recurringSchedules, error: recurringError } = recurringIds.length
      ? await admin
          .from("employee_recurring_payroll_components")
          .select("id,active")
          .eq("company_id", companyId)
          .in("id", recurringIds)
      : { data: [], error: null };
    if (recurringError) throw recurringError;
    const recurringActiveById = new Map(
      (recurringSchedules ?? []).map((item: any) => [item.id, item.active]),
    );
    const adjustmentRows = (adjustments ?? []).map((item: any) => ({
      ...item,
      recurring_active: item.recurring_component_id
        ? recurringActiveById.get(item.recurring_component_id) === true
        : false,
    }));
    const components = await payrollComponents(companyId);
    res.json({
      run,
      record,
      salary,
      attendance,
      adjustments: adjustmentRows,
      components: components.filter((component: any) => component.active),
    });
  } catch (e) {
    res.status(400).json({ error: eligibilityError(e) });
  }
});
router.get("/:id/export", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id)),
      id = uuid.parse(req.params.id);
    const m = await context(req, companyId);
    if (!m) return res.status(403).json({ error: "Company access denied" });
    const { data: rows, error } = await admin
      .from("payroll_records")
      .select("*, employees(employee_id,first_name,last_name,date_of_joining)")
      .eq("company_id", companyId)
      .eq("payroll_run_id", id)
      .order("employee_id");
    if (error) throw error;
    const XLSX = await import("xlsx");
    const mapped = (rows ?? []).map((r: any) => ({
      "Employee ID": r.employees?.employee_id ?? "",
      "Employee Name":
        `${r.employees?.first_name ?? ""} ${r.employees?.last_name ?? ""}`.trim(),
      "Joining Date": r.employees?.date_of_joining ?? "",
      "Paid Days": Number(r.paid_days ?? 0),
      "LOP Days": Number(r.lop_days),
      Basic: Number(r.basic_salary),
      "Special Allowance": Number(r.special_allowance),
      Gross: Number(r.gross_salary),
      "Employee PF": Number(r.employee_pf),
      "Employer PF": Number(r.employer_pf),
      PT: Number(r.professional_tax),
      TDS: Number(r.tds),
      "Other Deductions":
        Number(r.other_deductions) + Number(r.adjustment_deductions),
      "Total Deductions": Number(r.total_deductions),
      "Net Salary": Number(r.net_salary),
      "Employer Cost": Number(r.employer_cost),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(mapped),
      "Payroll",
    );
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="paymate-payroll-${id}.xlsx"`,
    );
    res.send(buf);
  } catch (e) {
    res.status(400).json({ error: eligibilityError(e) });
  }
});

export default router;
