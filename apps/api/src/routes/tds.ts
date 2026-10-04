import { Router } from "express";
import { z } from "zod";
import { admin } from "../lib/supabase.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { getMembership, canEdit, canView } from "../lib/authorization.js";
import {
  calculateAnnualTax,
  calculateTdsSchedule,
  type TaxRegime,
  type TaxSettings,
  type TaxSlab,
  type TaxRebate,
  type FirstMonthTdsMode,
} from "@paymate/shared";
import {
  calculateSalaryStructure,
  calculateMonthlyPayrollPreview,
  countWorkingDays,
  daysInMonth,
  eligiblePayrollDays,
  type AttendanceSettings,
  type PfSettings,
  type PtSettings,
} from "@paymate/shared";

const router = Router();
router.use(requireAuth);
const uuid = z.string().uuid();
const fySchema = z
  .string()
  .regex(/^20\d{2}-\d{2}$/, "Financial year must be YYYY-YY");
const profileSchema = z
  .object({
    employee_id: uuid,
    financial_year: fySchema,
    tax_regime: z.enum(["NEW", "OLD"]),
    previous_employer_taxable_salary: z.coerce.number().min(0),
    previous_employer_tds: z.coerce.number().min(0),
    other_taxable_income: z.coerce.number().min(0),
    other_tds: z.coerce.number().min(0),
    tax_declaration_status: z
      .enum(["PENDING", "SUBMITTED", "VERIFIED"])
      .default("PENDING"),
  })
  .strict();
const slabSchema = z.object({
  lower_limit: z.coerce.number().min(0),
  upper_limit: z.coerce.number().min(0).nullable(),
  rate: z.coerce.number().min(0).max(100),
});
const rebateSchema = z.object({
  income_limit: z.coerce.number().min(0),
  maximum_rebate: z.coerce.number().min(0),
});
const settingsSchema = z.object({
  financial_year: fySchema,
  regime: z.enum(["NEW", "OLD"]),
  standard_deduction: z.coerce.number().min(0),
  cess_rate: z.coerce.number().min(0).max(100),
  marginal_relief_enabled: z.boolean(),
  marginal_relief_income_limit: z.coerce.number().min(0).nullable(),
  first_month_tds_method: z.enum(["FULL_MONTHLY", "PRORATED_REDISTRIBUTE"]),
  first_month_tds_paid_day_factor: z.coerce.number().min(0).max(1).default(1),
  rounding_method: z.literal("WHOLE_RUPEE").default("WHOLE_RUPEE"),
  final_month_adjustment_enabled: z.boolean().default(true),
});
const calculateSchema = z.object({
  employee_id: uuid,
  financial_year: fySchema,
  tax_regime: z.enum(["NEW", "OLD"]),
  payroll_month: z.coerce.number().int().min(1).max(12),
  profile: z
    .object({
      previous_employer_taxable_salary: z.coerce.number().min(0).optional(),
      previous_employer_tds: z.coerce.number().min(0).optional(),
      other_taxable_income: z.coerce.number().min(0).optional(),
      other_tds: z.coerce.number().min(0).optional(),
    })
    .optional(),
});

function membership(req: AuthRequest, companyId: string) {
  return getMembership(req.userId!, companyId);
}
function fyYears(fy: string) {
  const start = Number(fy.slice(0, 4));
  return { start, end: start + 1 };
}
function fyMonths(fy: string) {
  const { start } = fyYears(fy);
  return [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3].map((month) => ({
    month,
    year: month >= 4 ? start : start + 1,
  }));
}
function monthBounds(year: number, month: number) {
  return {
    start: `${year}-${String(month).padStart(2, "0")}-01`,
    end: `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth(year, month)).padStart(2, "0")}`,
  };
}
function isBeforeOrEqual(a: string, b: string) {
  return a <= b;
}
function salaryForMonth(structures: any[], year: number, month: number) {
  const { start, end } = monthBounds(year, month);
  return structures
    .filter(
      (s) =>
        isBeforeOrEqual(String(s.effective_from), end) &&
        (!s.effective_to || isBeforeOrEqual(start, String(s.effective_to))),
    )
    .sort((a, b) =>
      String(b.effective_from).localeCompare(String(a.effective_from)),
    );
}
function periodUnits(
  year: number,
  month: number,
  settings: AttendanceSettings,
  startDay: number,
  endDay: number,
) {
  if (settings.prorationBasis === "CALENDAR_DAYS")
    return Math.max(0, endDay - startDay + 1);
  return countWorkingDays(year, month, settings, startDay, endDay);
}
async function getAttendanceSettings(
  companyId: string,
): Promise<AttendanceSettings> {
  const { data } = await admin
    .from("attendance_settings")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();
  return {
    prorationBasis:
      data?.proration_basis === "WORKING_DAYS"
        ? "WORKING_DAYS"
        : "CALENDAR_DAYS",
    weeklyOffDays: Array.isArray(data?.weekly_off_days)
      ? data.weekly_off_days
      : [0, 6],
    holidays: Array.isArray(data?.holidays) ? data.holidays : [],
    pfCalculationBasis:
      data?.pf_calculation_basis === "CONFIGURED_PF_WAGE"
        ? "CONFIGURED_PF_WAGE"
        : "ACTUAL_ADJUSTED_WAGES",
  };
}
async function projectEmployeeSalary(
  companyId: string,
  employee: any,
  fy: string,
) {
  const periods = fyMonths(fy);
  const [structuresResult, assignmentsResult] = await Promise.all([
    admin
      .from("salary_structures")
      .select("*")
      .eq("company_id", companyId)
      .eq("employee_id", employee.id)
      .order("effective_from", { ascending: true }),
    admin
      .from("employee_salary_assignments")
      .select(
        "annual_ctc,effective_from,pf_applicable,pt_applicable,tds_applicable",
      )
      .eq("company_id", companyId)
      .eq("employee_id", employee.id)
      .order("effective_from", { ascending: true }),
  ]);
  if (structuresResult.error || assignmentsResult.error)
    throw structuresResult.error || assignmentsResult.error;
  const assignments = assignmentsResult.data ?? [];
  const salaryRows = assignments.length
    ? assignments.map((assignment: any, index: number) => {
        const next = assignments[index + 1];
        const effectiveTo = next
          ? new Date(
              new Date(`${next.effective_from}T00:00:00Z`).getTime() -
                24 * 60 * 60 * 1000,
            )
              .toISOString()
              .slice(0, 10)
          : null;
        return { ...assignment, effective_to: effectiveTo };
      })
    : structuresResult.data ?? [];
  const { data: attendance } = await admin
    .from("attendance_records")
    .select("payroll_month,payroll_year,lop_days")
    .eq("company_id", companyId)
    .eq("employee_id", employee.id)
    .in("payroll_year", [...new Set(periods.map((p) => p.year))]);
  if (attendance === null) throw new Error("Unable to load attendance");
  const payrollYears = [...new Set(periods.map((period) => period.year))];
  const { data: runs, error: runsError } = await admin
    .from("payroll_runs")
    .select("id,payroll_month,payroll_year")
    .eq("company_id", companyId)
    .in("payroll_year", payrollYears);
  if (runsError) throw runsError;
  const periodRuns = (runs ?? []).filter((run) =>
    periods.some(
      (period) => period.month === run.payroll_month && period.year === run.payroll_year,
    ),
  );
  const runIds = periodRuns.map((run) => run.id);
  const { data: adjustments, error: adjustmentError } = runIds.length
    ? await admin
        .from("payroll_adjustments")
        .select("payroll_run_id,amount,adjustment_type,component_type,component_taxable")
        .eq("company_id", companyId)
        .eq("employee_id", employee.id)
        .in("payroll_run_id", runIds)
        .eq("voided", false)
    : { data: [], error: null };
  if (adjustmentError) throw adjustmentError;
  const taxableAdjustments = new Map<number, number>();
  for (const adjustment of adjustments ?? []) {
    const direction =
      adjustment.component_type ??
      (adjustment.adjustment_type === "OTHER_DEDUCTION" ? "DEDUCTION" : "EARNING");
    if (direction !== "EARNING" || adjustment.component_taxable === false) continue;
    const run = periodRuns.find((candidate) => candidate.id === adjustment.payroll_run_id);
    if (!run) continue;
    const periodIndex = periods.findIndex(
      (period) => period.month === run.payroll_month && period.year === run.payroll_year,
    );
    taxableAdjustments.set(
      periodIndex,
      (taxableAdjustments.get(periodIndex) ?? 0) + Number(adjustment.amount),
    );
  }
  const attSettings = await getAttendanceSettings(companyId);
  const [{ data: pf, error: pfError }, { data: pt, error: ptError }] =
    await Promise.all([
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
  if (pfError || ptError) throw pfError || ptError;
  const pfSettings: PfSettings = {
    enabled: pf?.enabled !== false,
    employeePfRate: Number(pf?.employee_pf_rate ?? 12),
    employerPfRate: Number(pf?.employer_pf_rate ?? 12),
    pfWageCeiling: Number(pf?.pf_wage_ceiling ?? 25000),
    minimumBasic: Number(pf?.minimum_basic ?? 20000),
    basicPercentage: Number(pf?.basic_percentage ?? 50),
  };
  const ptSettings: PtSettings = {
    enabled: Boolean(pt?.enabled),
    state: pt?.state ?? null,
    slabs: Array.isArray(pt?.slabs) ? pt.slabs : [],
  };
  const months: any[] = [];
  for (const p of periods) {
    const calendar = daysInMonth(p.year, p.month);
    const { start, end } = monthBounds(p.year, p.month);
    const overlapping = salaryForMonth(salaryRows, p.year, p.month);
    const attendanceRow = (attendance ?? []).find(
      (a) =>
        Number(a.payroll_year) === p.year &&
        Number(a.payroll_month) === p.month,
    );
    const lop = Math.max(0, Number(attendanceRow?.lop_days ?? 0));
    const eligible = eligiblePayrollDays(
      p.year,
      p.month,
      employee.date_of_joining,
      attSettings,
    );
    const divisor =
      attSettings.prorationBasis === "WORKING_DAYS"
        ? countWorkingDays(p.year, p.month, attSettings)
        : calendar;
    let baseGross = 0;
    for (const s of overlapping) {
      const joiningMonthStart =
        employee.date_of_joining > start && employee.date_of_joining < end
          ? employee.date_of_joining
          : employee.date_of_joining >= end
            ? end
            : start;
      const segStart =
        (s.effective_from > start ? s.effective_from : start) >
        joiningMonthStart
          ? s.effective_from > start
            ? s.effective_from
            : start
          : joiningMonthStart;
      const segEnd =
        s.effective_to && s.effective_to < end ? s.effective_to : end;
      if (segStart > segEnd || employee.date_of_joining > end) continue;
      const sd = Number(segStart.slice(8, 10));
      const ed = Number(segEnd.slice(8, 10));
      const currentSalary = calculateSalaryStructure({
        annualCtc: Number(s.annual_ctc),
        pfSettings: {
          ...pfSettings,
          enabled: pfSettings.enabled !== false && s.pf_applicable !== false,
        },
        ptSettings: {
          ...ptSettings,
          enabled: ptSettings.enabled && s.pt_applicable !== false,
        },
      });
      baseGross +=
        (currentSalary.grossSalary *
          periodUnits(p.year, p.month, attSettings, sd, ed)) /
        Math.max(1, eligible);
    }
    const preview = calculateMonthlyPayrollPreview({
      salaryStructure: {
        annual_ctc: 0,
        monthly_ctc: baseGross,
        basic_salary: baseGross,
        special_allowance: 0,
        gross_salary: baseGross,
        employee_pf: 0,
        employer_pf: 0,
        professional_tax: 0,
      },
      payrollMonth: p.month,
      payrollYear: p.year,
      joiningDate: employee.date_of_joining,
      lopDays: lop,
      attendanceSettings: attSettings,
      pfSettings: {
        enabled: false,
        employeePfRate: 0,
        employerPfRate: 0,
        pfWageCeiling: 0,
        minimumBasic: 0,
        basicPercentage: 0,
      },
      ptSettings: { enabled: false, state: null, slabs: [] },
    });
    const adjustedGross = preview.grossSalary;
    months.push({
      month: p.month,
      year: p.year,
      projectedSalary: Math.max(0, adjustedGross + (taxableAdjustments.get(months.length) ?? 0)),
      eligibleDays: eligible,
      lopDays: lop,
      daysInMonth: calendar,
      hasSalary: overlapping.length > 0,
    });
  }
  return {
    months,
    totalProjectedSalary: months.reduce((n, m) => n + m.projectedSalary, 0),
  };
}
async function loadTaxConfig(companyId: string, fy: string, regime: TaxRegime) {
  const { data: settings, error: se } = await admin
    .from("tax_settings")
    .select("*")
    .eq("company_id", companyId)
    .eq("financial_year", fy)
    .eq("regime", regime)
    .single();
  if (se) throw new Error(`Tax settings not configured for ${fy} / ${regime}`);
  const { data: slabs, error: slabError } = await admin
    .from("tax_slabs")
    .select("*")
    .eq("company_id", companyId)
    .eq("financial_year", fy)
    .eq("regime", regime)
    .order("lower_limit");
  if (slabError) throw slabError;
  const { data: rebate, error: rebateError } = await admin
    .from("tax_rebates")
    .select("*")
    .eq("company_id", companyId)
    .eq("financial_year", fy)
    .eq("regime", regime)
    .single();
  if (rebateError) throw rebateError;
  const taxSettings: TaxSettings = {
    financialYear: fy,
    regime,
    standardDeduction: Number(settings.standard_deduction),
    cessRate: Number(settings.cess_rate),
    marginalReliefEnabled: Boolean(settings.marginal_relief_enabled),
    marginalReliefIncomeLimit:
      settings.marginal_relief_income_limit === null
        ? undefined
        : Number(settings.marginal_relief_income_limit),
    slabs: (slabs ?? []).map(
      (s: any): TaxSlab => ({
        lowerLimit: Number(s.lower_limit),
        upperLimit: s.upper_limit === null ? null : Number(s.upper_limit),
        rate: Number(s.rate),
      }),
    ),
    rebate: {
      incomeLimit: Number(rebate.income_limit),
      maximumRebate: Number(rebate.maximum_rebate),
    },
  };
  return {
    taxSettings,
    firstMonthTdsMethod: settings.first_month_tds_method as FirstMonthTdsMode,
    firstMonthTdsPaidDayFactor: Number(
      settings.first_month_tds_paid_day_factor ?? 1,
    ),
  };
}
async function getEmployee(companyId: string, employeeId: string) {
  const { data, error } = await admin
    .from("employees")
    .select("*,employee_previous_employment(taxable_salary,tds_deducted)")
    .eq("company_id", companyId)
    .eq("id", employeeId)
    .single();
  if (error || !data) throw new Error("Employee not found");
  return data;
}

async function getCompanyTaxRegime(companyId: string): Promise<TaxRegime> {
  const { data, error } = await admin
    .from("payroll_settings")
    .select("default_tax_regime")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  return data?.default_tax_regime === "OLD" ? "OLD" : "NEW";
}

async function getPriorCurrentEmployerTds(
  companyId: string,
  employeeId: string,
  fy: string,
  currentMonth: number,
) {
  const periods = fyMonths(fy);
  const currentIndex = periods.findIndex(
    (period) => period.month === currentMonth,
  );
  const priorPeriods = periods.slice(0, Math.max(0, currentIndex));
  if (!priorPeriods.length) return 0;
  const { data: runs, error: runError } = await admin
    .from("payroll_runs")
    .select("id,payroll_month,payroll_year")
    .eq("company_id", companyId)
    .in("payroll_year", [...new Set(priorPeriods.map((period) => period.year))])
    .in("status", ["APPROVED", "LOCKED"]);
  if (runError) throw runError;
  const priorRunIds = (runs ?? [])
    .filter((run) =>
      priorPeriods.some(
        (period) =>
          period.month === run.payroll_month &&
          period.year === run.payroll_year,
      ),
    )
    .map((run) => run.id);
  if (!priorRunIds.length) return 0;
  const { data: records, error: recordsError } = await admin
    .from("payroll_records")
    .select("tds")
    .eq("company_id", companyId)
    .eq("employee_id", employeeId)
    .in("payroll_run_id", priorRunIds);
  if (recordsError) throw recordsError;
  return (records ?? []).reduce(
    (total, record) => total + Number(record.tds),
    0,
  );
}

router.get("/settings", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await membership(req, companyId);
    if (!m || !canView(m.role))
      return res.status(403).json({ error: "Company access denied" });
    const fy = fySchema.parse(String(req.query.financial_year || "2026-27"));
    const regime = String(req.query.regime || "NEW") as TaxRegime;
    const cfg = await loadTaxConfig(companyId, fy, regime);
    res.json({
      settings: {
        ...cfg.taxSettings,
        slabs: cfg.taxSettings.slabs.map((slab) => ({
          lower_limit: slab.lowerLimit,
          upper_limit: slab.upperLimit,
          rate: slab.rate,
        })),
        standard_deduction: cfg.taxSettings.standardDeduction,
        cess_rate: cfg.taxSettings.cessRate,
        marginal_relief_enabled: cfg.taxSettings.marginalReliefEnabled,
        marginal_relief_income_limit:
          cfg.taxSettings.marginalReliefIncomeLimit ?? null,
        first_month_tds_paid_day_factor: cfg.firstMonthTdsPaidDayFactor,
        first_month_tds_method: cfg.firstMonthTdsMethod,
        rebate: {
          income_limit: cfg.taxSettings.rebate.incomeLimit,
          maximum_rebate: cfg.taxSettings.rebate.maximumRebate,
        },
      },
    });
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : "Unable to load tax settings",
    });
  }
});
router.put("/settings/slabs", async (req: AuthRequest, res) => {
  const body = z
    .object({
      financial_year: fySchema,
      regime: z.enum(["NEW", "OLD"]),
      slabs: z.array(slabSchema).min(1),
      rebate: rebateSchema,
    })
    .safeParse(req.body);
  if (!body.success)
    return res.status(400).json({
      error: "Invalid tax slabs",
      details: body.error.flatten().fieldErrors,
    });
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await membership(req, companyId);
    if (!m || !["OWNER", "COMPANY_ADMIN"].includes(m.role))
      return res
        .status(403)
        .json({ error: "Only company administrators can modify tax slabs" });
    for (const slab of body.data.slabs) {
      if (slab.upper_limit !== null && slab.upper_limit <= slab.lower_limit)
        throw new Error("Tax slab upper limit must exceed lower limit");
    }
    await admin
      .from("tax_slabs")
      .delete()
      .eq("company_id", companyId)
      .eq("financial_year", body.data.financial_year)
      .eq("regime", body.data.regime);
    const { data: slabs, error } = await admin
      .from("tax_slabs")
      .insert(
        body.data.slabs.map((s) => ({
          company_id: companyId,
          financial_year: body.data.financial_year,
          regime: body.data.regime,
          lower_limit: s.lower_limit,
          upper_limit: s.upper_limit,
          rate: s.rate,
        })),
      )
      .select("*")
      .order("lower_limit");
    if (error) throw error;
    const { data: rebate, error: re } = await admin
      .from("tax_rebates")
      .upsert(
        {
          company_id: companyId,
          financial_year: body.data.financial_year,
          regime: body.data.regime,
          ...body.data.rebate,
        },
        { onConflict: "company_id,financial_year,regime" },
      )
      .select("*")
      .single();
    if (re) throw re;
    res.json({ slabs, rebate });
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : "Unable to save tax slabs",
    });
  }
});
router.put("/settings", async (req: AuthRequest, res) => {
  const p = settingsSchema.safeParse(req.body);
  if (!p.success)
    return res.status(400).json({
      error: "Invalid tax settings",
      details: p.error.flatten().fieldErrors,
    });
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await membership(req, companyId);
    if (!m || !["OWNER", "COMPANY_ADMIN"].includes(m.role))
      return res
        .status(403)
        .json({ error: "Only company administrators can modify tax settings" });
    const { data, error } = await admin
      .from("tax_settings")
      .upsert(
        { company_id: companyId, ...p.data },
        { onConflict: "company_id,financial_year,regime" },
      )
      .select("*")
      .single();
    if (error) throw error;
    res.json({ settings: data });
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : "Unable to save tax settings",
    });
  }
});
router.get("/profile/:employeeId", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const employeeId = uuid.parse(req.params.employeeId);
    const m = await membership(req, companyId);
    if (!m || !canView(m.role))
      return res.status(403).json({ error: "Company access denied" });
    await getEmployee(companyId, employeeId);
    const fy = fySchema.parse(String(req.query.financial_year || "2026-27"));
    const { data } = await admin
      .from("employee_tax_profiles")
      .select("*")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .eq("financial_year", fy)
      .maybeSingle();
    res.json({ profile: data });
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : "Unable to load TDS profile",
    });
  }
});
router.put("/profile", async (req: AuthRequest, res) => {
  const p = profileSchema.safeParse(req.body);
  if (!p.success)
    return res.status(400).json({
      error: "Invalid TDS profile",
      details: p.error.flatten().fieldErrors,
    });
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await membership(req, companyId);
    if (!m || !canEdit(m.role))
      return res.status(403).json({ error: "Insufficient permissions" });
    await getEmployee(companyId, p.data.employee_id);
    const { data, error } = await admin
      .from("employee_tax_profiles")
      .upsert(
        { company_id: companyId, ...p.data },
        { onConflict: "company_id,employee_id,financial_year" },
      )
      .select("*")
      .single();
    if (error) throw error;
    res.json({ profile: data });
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : "Unable to save TDS profile",
    });
  }
});
export async function calculateEmployeeTds(
  companyId: string,
  employeeId: string,
  financialYear: string,
  payrollMonth: number,
  profileOverrides: Record<string, number> = {},
  regimeOverride?: TaxRegime,
) {
  const employee = await getEmployee(companyId, employeeId);
  const profileRow = await admin
    .from("employee_tax_profiles")
    .select("*")
    .eq("company_id", companyId)
    .eq("employee_id", employeeId)
    .eq("financial_year", financialYear)
    .maybeSingle();
  if (profileRow.error) throw profileRow.error;
  let savedProfile = profileRow.data;
  const taxRegime =
    regimeOverride ??
    (savedProfile?.tax_regime as TaxRegime | undefined) ??
    (await getCompanyTaxRegime(companyId));
  const previousEmployment = Array.isArray(employee.employee_previous_employment)
    ? employee.employee_previous_employment[0]
    : employee.employee_previous_employment;
  if (!savedProfile) {
    const { data, error } = await admin
      .from("employee_tax_profiles")
      .upsert(
        {
          company_id: companyId,
          employee_id: employeeId,
          financial_year: financialYear,
          tax_regime: taxRegime,
          previous_employer_taxable_salary: Number(
            previousEmployment?.taxable_salary ?? 0,
          ),
          previous_employer_tds: Number(previousEmployment?.tds_deducted ?? 0),
          other_taxable_income: 0,
          other_tds: 0,
          tax_declaration_status: "PENDING",
        },
        { onConflict: "company_id,employee_id,financial_year" },
      )
      .select("*")
      .single();
    if (error) throw error;
    savedProfile = data;
  }
  const source = { ...savedProfile, ...profileOverrides };
  const previousEmployerTaxableSalary = Number(
    source.previous_employer_taxable_salary ??
      previousEmployment?.taxable_salary ??
      0,
  );
  const previousEmployerTds = Number(
    source.previous_employer_tds ?? previousEmployment?.tds_deducted ?? 0,
  );
  const otherTaxableIncome = Number(source.other_taxable_income ?? 0);
  const otherTds = Number(source.other_tds ?? 0);
  const cfg = await loadTaxConfig(companyId, financialYear, taxRegime);
  const projection = await projectEmployeeSalary(
    companyId,
    employee,
    financialYear,
  );
  const annual = calculateAnnualTax({
    financialYear,
    taxRegime,
    previousEmployerTaxableSalary,
    previousEmployerTds,
    currentEmployerProjectedTaxableSalary: projection.totalProjectedSalary,
    otherTaxableIncome,
    otherTds,
    settings: cfg.taxSettings,
  });
  const currentIndex = projection.months.findIndex(
    (period) => period.month === payrollMonth,
  );
  const currentAndFuturePeriods = projection.months.slice(
    Math.max(0, currentIndex),
  );
  const futureMonths = currentAndFuturePeriods.filter(
    (period) => period.hasSalary && period.eligibleDays > period.lopDays,
  );
  const first = futureMonths[0];
  const priorCurrentTds = await getPriorCurrentEmployerTds(
    companyId,
    employee.id,
    financialYear,
    payrollMonth,
  );
  const alreadyDeducted = annual.previousTds + annual.otherTds + priorCurrentTds;
  const remainingTdsAfterPrior = Math.max(
    0,
    annual.annualTaxLiability - alreadyDeducted,
  );
  const allocation = calculateTdsSchedule({
    annualTaxLiability: annual.annualTaxLiability,
    alreadyDeducted,
    payrollMonths: futureMonths.length,
    firstMonthPaidDays: Math.max(
      0,
      Number(first?.eligibleDays ?? 0) - Number(first?.lopDays ?? 0),
    ),
    firstMonthDays: Number(first?.daysInMonth ?? 30),
    firstMonthPaidDayFactor: cfg.firstMonthTdsPaidDayFactor,
    method: cfg.firstMonthTdsMethod,
  });
  const schedule = allocation.schedule.map((row, index) => ({
    ...row,
    payrollMonth: futureMonths[index]?.month ?? row.month,
    projectedIncome: futureMonths[index]?.projectedSalary ?? 0,
  }));
  const stored = {
    company_id: companyId,
    employee_id: employee.id,
    financial_year: financialYear,
    taxable_income: annual.taxableIncome,
    tax_before_rebate: annual.taxBeforeRebate,
    rebate: annual.rebate,
    marginal_relief: annual.marginalRelief,
    tax_after_rebate: annual.taxAfterRebate,
    cess: annual.cess,
    annual_tax: annual.annualTaxLiability,
    previous_tds: annual.previousTds,
    remaining_tds: remainingTdsAfterPrior,
    calculation: { ...annual, projection, allocation, alreadyDeducted },
  };
  const { data: calc, error: calcError } = await admin
    .from("tds_calculations")
    .upsert(stored, { onConflict: "company_id,employee_id,financial_year" })
    .select("*")
    .single();
  if (calcError) throw calcError;
  const scheduleMonths = currentAndFuturePeriods.map((period) => period.month);
  if (scheduleMonths.length) {
    const { error } = await admin
      .from("tds_monthly_schedule")
      .delete()
      .eq("company_id", companyId)
      .eq("employee_id", employee.id)
      .eq("financial_year", financialYear)
      .in("payroll_month", scheduleMonths);
    if (error) throw error;
  }
  if (schedule.length) {
    const rows = schedule.map((row: any) => ({
      company_id: companyId,
      employee_id: employee.id,
      financial_year: financialYear,
      payroll_month: row.payrollMonth,
      projected_income: row.projectedIncome,
      tds_amount: row.tdsAmount,
      deferred_amount: row.deferredAmount,
      cumulative_tds: row.cumulativeTds,
    }));
    const { error } = await admin.from("tds_monthly_schedule").upsert(rows, {
      onConflict: "company_id,employee_id,financial_year,payroll_month",
    });
    if (error) throw error;
  }
  return {
    employee,
    inputs: {
      previousEmployerTaxableSalary,
      previousEmployerTds,
      otherTaxableIncome,
      otherTds,
      currentEmployerTdsAlreadyDeducted: priorCurrentTds,
    },
    annualTax: annual,
    projection,
    allocation,
    schedule,
    currentMonthTds:
      schedule.find((row: any) => row.payrollMonth === payrollMonth)?.tdsAmount ?? 0,
    remainingTdsAfterPrior,
    calculation: calc,
  };
}

router.post("/calculate", async (req: AuthRequest, res) => {
  const p = calculateSchema.safeParse(req.body);
  if (!p.success)
    return res.status(400).json({
      error: "Invalid TDS calculation request",
      details: p.error.flatten().fieldErrors,
    });
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await membership(req, companyId);
    if (!m || !canView(m.role))
      return res.status(403).json({ error: "Company access denied" });
    const result = await calculateEmployeeTds(
      companyId,
      p.data.employee_id,
      p.data.financial_year,
      p.data.payroll_month,
      p.data.profile ?? {},
      p.data.tax_regime,
    );
    res.json(result);
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : "Unable to calculate TDS",
    });
  }
});
router.get("/employee/:employeeId", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const employeeId = uuid.parse(req.params.employeeId);
    const m = await membership(req, companyId);
    if (!m || !canView(m.role))
      return res.status(403).json({ error: "Company access denied" });
    await getEmployee(companyId, employeeId);
    const fy = fySchema.parse(String(req.query.financial_year || "2026-27"));
    const [{ data: calc }, { data: schedule }, { data: profile }] =
      await Promise.all([
        admin
          .from("tds_calculations")
          .select("*")
          .eq("company_id", companyId)
          .eq("employee_id", employeeId)
          .eq("financial_year", fy)
          .maybeSingle(),
        admin
          .from("tds_monthly_schedule")
          .select("*")
          .eq("company_id", companyId)
          .eq("employee_id", employeeId)
          .eq("financial_year", fy)
          .order("payroll_month"),
        admin
          .from("employee_tax_profiles")
          .select("*")
          .eq("company_id", companyId)
          .eq("employee_id", employeeId)
          .eq("financial_year", fy)
          .maybeSingle(),
      ]);
    res.json({ calculation: calc, schedule: schedule ?? [], profile });
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : "Unable to load TDS details",
    });
  }
});
router.get("/", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await membership(req, companyId);
    if (!m || !canView(m.role))
      return res.status(403).json({ error: "Company access denied" });
    const fy = fySchema.parse(String(req.query.financial_year || "2026-27"));
    const { data, error } = await admin
      .from("tds_calculations")
      .select("*, employees(employee_id,first_name,last_name)")
      .eq("company_id", companyId)
      .eq("financial_year", fy)
      .order("taxable_income", { ascending: false });
    if (error) throw error;
    const currentMonth = Number(
      req.query.payroll_month || new Date().getMonth() + 1,
    );
    const schedules =
      (
        await admin
          .from("tds_monthly_schedule")
          .select("employee_id,payroll_month,tds_amount")
          .eq("company_id", companyId)
          .eq("financial_year", fy)
          .eq("payroll_month", currentMonth)
      ).data ?? [];
    const rows = (data ?? []).map((r: any) => ({
      ...r,
      current_month_tds: Number(
        schedules.find((s: any) => s.employee_id === r.employee_id)
          ?.tds_amount ?? 0,
      ),
      status: Number(r.remaining_tds) > 0 ? "Calculated" : "No TDS",
    }));
    res.json({ calculations: rows });
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : "Unable to load TDS calculations",
    });
  }
});
router.get("/dashboard", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await membership(req, companyId);
    if (!m || !canView(m.role))
      return res.status(403).json({ error: "Company access denied" });
    const fy = fySchema.parse(String(req.query.financial_year || "2026-27"));
    const { data, error } = await admin
      .from("tds_calculations")
      .select("annual_tax,remaining_tds,previous_tds")
      .eq("company_id", companyId)
      .eq("financial_year", fy);
    if (error) throw error;
    const rows = data ?? [];
    res.json({
      totalAnnualTds: rows.reduce((n, r) => n + Number(r.annual_tax), 0),
      currentMonthTds: rows.reduce((n, r) => n + Number(r.remaining_tds), 0),
      employeesWithTds: rows.filter((r) => Number(r.remaining_tds) > 0).length,
      employeesWithZeroTds: rows.filter((r) => Number(r.remaining_tds) === 0)
        .length,
      previousEmployerTds: rows.reduce((n, r) => n + Number(r.previous_tds), 0),
    });
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : "Unable to load TDS dashboard",
    });
  }
});

router.get("/export", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await membership(req, companyId);
    if (!m || !canView(m.role))
      return res.status(403).json({ error: "Company access denied" });
    const fy = fySchema.parse(String(req.query.financial_year || "2026-27"));
    const { data, error } = await admin
      .from("tds_calculations")
      .select("*, employees(employee_id,first_name,last_name)")
      .eq("company_id", companyId)
      .eq("financial_year", fy);
    if (error) throw error;
    const XLSX = await import("xlsx");
    const rows = (data ?? []).map((r: any) => ({
      "Employee ID": r.employees?.employee_id ?? "",
      Employee:
        `${r.employees?.first_name ?? ""} ${r.employees?.last_name ?? ""}`.trim(),
      "Taxable Income": Number(r.taxable_income),
      "Annual Tax": Number(r.annual_tax),
      "Previous TDS": Number(r.previous_tds),
      "Remaining TDS": Number(r.remaining_tds),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "TDS");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="paymate-tds-${fy}.xlsx"`,
    );
    res.send(buf);
  } catch (e) {
    res
      .status(400)
      .json({ error: e instanceof Error ? e.message : "Unable to export TDS" });
  }
});

export default router;
