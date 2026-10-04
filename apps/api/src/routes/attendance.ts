import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { admin } from "../lib/supabase.js";
import { writeAudit } from "../lib/audit.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { canEdit, canView, getMembership } from "../lib/authorization.js";
import {
  calculateMonthlyPayrollPreview,
  calculateSalaryStructure,
  type AttendanceSettings,
  type MonthlySalaryStructure,
  type PfSettings,
  type PtSettings,
  type ProrationBasis,
  type PfCalculationBasis,
} from "@paymate/shared";

const router = Router();
router.use(requireAuth);
const uuid = z.string().uuid();
const periodSchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(1900).max(2200),
});
const settingsSchema = z.object({
  prorationBasis: z.enum(["CALENDAR_DAYS", "WORKING_DAYS"]),
  weeklyOffDays: z.array(z.number().int().min(0).max(6)).max(7),
  holidays: z.array(z.string().date()).max(1000),
  pfCalculationBasis: z.enum(["ACTUAL_ADJUSTED_WAGES", "CONFIGURED_PF_WAGE"]),
});
const rowSchema = z.object({
  employee_id: uuid,
  present_days: z.number().nonnegative(),
  paid_leave_days: z.number().nonnegative(),
  lop_days: z.number().nonnegative(),
});
const bulkSchema = z.object({ rows: z.array(rowSchema).max(5000) });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});
const DEFAULT_SETTINGS: AttendanceSettings = {
  prorationBasis: "CALENDAR_DAYS",
  weeklyOffDays: [0, 6],
  holidays: [],
  pfCalculationBasis: "ACTUAL_ADJUSTED_WAGES",
};

async function getContext(req: AuthRequest, companyId: string) {
  const membership = await getMembership(req.userId!, companyId);
  if (!membership || !canView(membership.role)) return null;
  return membership;
}

async function assertPayrollPeriodOpen(
  companyId: string,
  month: number,
  year: number,
) {
  const { data: run, error } = await admin
    .from("payroll_runs")
    .select("status")
    .eq("company_id", companyId)
    .eq("payroll_month", month)
    .eq("payroll_year", year)
    .maybeSingle();
  if (error) throw error;
  if (run && ["APPROVED", "LOCKED"].includes(run.status))
    throw new Error(
      "This payroll period is approved or locked. Attendance cannot be modified until an authorized administrator reopens the payroll.",
    );
}

async function getPayrollSettings(
  companyId: string,
): Promise<{ attendance: AttendanceSettings; pf: PfSettings; pt: PtSettings }> {
  const [attendance, pf, pt] = await Promise.all([
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
  if (attendance.error || pf.error || pt.error)
    throw attendance.error || pf.error || pt.error;
  let a = attendance.data;
  if (!a) {
    const { data, error } = await admin
      .from("attendance_settings")
      .insert({
        company_id: companyId,
        proration_basis: DEFAULT_SETTINGS.prorationBasis,
        weekly_off_days: DEFAULT_SETTINGS.weeklyOffDays,
        holidays: DEFAULT_SETTINGS.holidays,
        pf_calculation_basis: DEFAULT_SETTINGS.pfCalculationBasis,
      })
      .select("*")
      .single();
    if (error) throw error;
    a = data;
  }
  if (!pf.data || !pt.data)
    throw new Error(
      "Payroll settings are not configured. Open Salary & Tax Settings first.",
    );
  return {
    attendance: {
      prorationBasis: a.proration_basis as ProrationBasis,
      weeklyOffDays: (a.weekly_off_days ?? [0, 6]) as number[],
      holidays: (a.holidays ?? []) as string[],
      pfCalculationBasis: a.pf_calculation_basis as PfCalculationBasis,
    },
    pf: {
      enabled: pf.data.enabled,
      employeePfRate: Number(pf.data.employee_pf_rate),
      employerPfRate: Number(pf.data.employer_pf_rate),
      pfWageCeiling: Number(pf.data.pf_wage_ceiling),
      minimumBasic: Number(pf.data.minimum_basic),
      basicPercentage: Number(pf.data.basic_percentage),
    },
    pt: {
      enabled: pt.data.enabled,
      state: pt.data.state,
      slabs: pt.data.slabs ?? [],
    },
  };
}

function periodEnd(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
function periodStart(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

async function getEmployeesAndSalary(
  companyId: string,
  month: number,
  year: number,
  cfg: Awaited<ReturnType<typeof getPayrollSettings>>,
) {
  const [employeesResult, salariesResult, legacySalariesResult, attendanceResult] = await Promise.all(
    [
      admin
        .from("employees")
        .select(
          "id,employee_id,first_name,last_name,date_of_joining,department_id,employment_status,departments(name)",
        )
        .eq("company_id", companyId)
        .eq("employment_status", "ACTIVE")
        .lte("date_of_joining", periodEnd(year, month))
        .order("employee_id"),
      admin
        .from("employee_salary_assignments")
        .select("employee_id,annual_ctc,effective_from")
        .eq("company_id", companyId)
        .lte("effective_from", periodEnd(year, month))
        .order("effective_from", { ascending: false }),
      admin
        .from("salary_structures")
        .select("*")
        .eq("company_id", companyId)
        .lte("effective_from", periodEnd(year, month))
        .or(`effective_to.is.null,effective_to.gte.${periodStart(year, month)}`)
        .order("effective_from", { ascending: false }),
      admin
        .from("attendance_records")
        .select("*")
        .eq("company_id", companyId)
        .eq("payroll_month", month)
        .eq("payroll_year", year),
    ],
  );
  if (employeesResult.error || salariesResult.error || legacySalariesResult.error || attendanceResult.error)
    throw (
      employeesResult.error || salariesResult.error || legacySalariesResult.error || attendanceResult.error
    );
  const salaryByEmployee = new Map<string, any>();
  for (const assignment of salariesResult.data ?? []) {
    if (salaryByEmployee.has(assignment.employee_id) || Number(assignment.annual_ctc) <= 0) continue;
    const calculated = calculateSalaryStructure({ annualCtc: Number(assignment.annual_ctc), pfSettings: cfg.pf, ptSettings: cfg.pt });
    salaryByEmployee.set(assignment.employee_id, {
      ...assignment,
      annual_ctc: calculated.annualCtc,
      monthly_ctc: calculated.monthlyCtc,
      basic_salary: calculated.basicSalary,
      special_allowance: calculated.specialAllowance,
      gross_salary: calculated.grossSalary,
      employee_pf: calculated.employeePf,
      employer_pf: calculated.employerPf,
      professional_tax: calculated.professionalTax,
    });
  }
  for (const salary of legacySalariesResult.data ?? [])
    if (!salaryByEmployee.has(salary.employee_id))
      salaryByEmployee.set(salary.employee_id, salary);
  const recordByEmployee = new Map(
    (attendanceResult.data ?? []).map((r) => [r.employee_id, r]),
  );
  return {
    employees: employeesResult.data ?? [],
    salaryByEmployee,
    recordByEmployee,
  };
}

router.get("/settings", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    if (!(await getContext(req, companyId)))
      return res.status(403).json({ error: "Company access denied" });
    res.json(await getPayrollSettings(companyId));
  } catch (e) {
    res.status(400).json({
      error:
        e instanceof Error ? e.message : "Unable to load attendance settings",
    });
  }
});

router.put("/settings", async (req: AuthRequest, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({
      error: "Invalid attendance settings",
      details: parsed.error.flatten().fieldErrors,
    });
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const membership = await getContext(req, companyId);
    if (!membership || !canEdit(membership.role))
      return res.status(403).json({ error: "Insufficient permissions" });
    const s = parsed.data;
    const { data, error } = await admin
      .from("attendance_settings")
      .upsert(
        {
          company_id: companyId,
          proration_basis: s.prorationBasis,
          weekly_off_days: s.weeklyOffDays,
          holidays: s.holidays,
          pf_calculation_basis: s.pfCalculationBasis,
        },
        { onConflict: "company_id" },
      )
      .select("*")
      .single();
    if (error) throw error;
    res.json({
      message: "Attendance settings saved",
      settings: {
        prorationBasis: data.proration_basis,
        weeklyOffDays: data.weekly_off_days,
        holidays: data.holidays,
        pfCalculationBasis: data.pf_calculation_basis,
      },
    });
  } catch (e) {
    res.status(400).json({
      error:
        e instanceof Error ? e.message : "Unable to save attendance settings",
    });
  }
});

router.get("/export", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = periodSchema.parse({
      month: req.query.month,
      year: req.query.year,
    });
    if (!(await getContext(req, companyId)))
      return res.status(403).json({ error: "Company access denied" });
    const cfg = await getPayrollSettings(companyId);
    const { employees, salaryByEmployee, recordByEmployee } =
      await getEmployeesAndSalary(companyId, m.month, m.year, cfg);
    const rows = employees
      .map((e: any) => {
        const r = recordByEmployee.get(e.id);
        const s = salaryByEmployee.get(e.id);
        if (!s) return null;
        const preview = calculateMonthlyPayrollPreview({
          salaryStructure: s,
          payrollMonth: m.month,
          payrollYear: m.year,
          joiningDate: e.date_of_joining,
          lopDays: Number(r?.lop_days ?? 0),
          presentDays: r ? Number(r.present_days) : undefined,
          paidLeaveDays: r ? Number(r.paid_leave_days) : undefined,
          attendanceSettings: cfg.attendance,
          pfSettings: cfg.pf,
          ptSettings: cfg.pt,
        });
        return {
          "Employee ID": e.employee_id,
          "Employee Name": `${e.first_name} ${e.last_name}`.trim(),
          "Joining Date": e.date_of_joining,
          "Working Days": preview.workingDays,
          "Present Days": preview.presentDays,
          "Paid Leave": preview.paidLeaveDays,
          "LOP Days": preview.lopDays,
          "Paid Days": preview.paidDays,
          "Original Gross": preview.originalGross,
          "LOP Deduction": preview.lopDeduction,
          "Adjusted Gross": preview.grossSalary,
          "Employee PF": preview.employeePf,
          "Employer PF": preview.employerPf,
          PT: preview.professionalTax,
          "Net Salary": preview.estimatedNetSalary,
        };
      })
      .filter(Boolean);
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(rows),
      "Attendance",
    );
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="paymate-attendance-${m.year}-${String(m.month).padStart(2, "0")}.xlsx"`,
    );
    res.send(buf);
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : "Unable to export attendance",
    });
  }
});

router.get("/template", async (_req, res) => {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet([
    {
      "Employee ID": "EMP001",
      "Employee Name": "Sample Employee",
      "Payroll Month": "September 2026",
      "Present Days": 28,
      "Paid Leave": 0,
      "LOP Days": 2,
    },
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Attendance Template");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="paymate-attendance-template.xlsx"',
  );
  res.send(buf);
});

router.get("/employee/:employeeId/history", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id)),
      employeeId = uuid.parse(req.params.employeeId);
    if (!(await getContext(req, companyId)))
      return res.status(403).json({ error: "Company access denied" });
    const { data, error } = await admin
      .from("attendance_records")
      .select("*")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .order("payroll_year", { ascending: false })
      .order("payroll_month", { ascending: false });
    if (error) throw error;
    const cfg = await getPayrollSettings(companyId);
    const { data: employee } = await admin
      .from("employees")
      .select("id,employee_id,first_name,last_name,date_of_joining")
      .eq("company_id", companyId)
      .eq("id", employeeId)
      .maybeSingle();
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    const { data: salaries } = await admin
      .from("salary_structures")
      .select("*")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .order("effective_from", { ascending: false });
    const rows = (data ?? []).map((r) => {
      const s = (salaries ?? [])
        .filter(
          (x) =>
            x.effective_from <=
            `${r.payroll_year}-${String(r.payroll_month).padStart(2, "0")}-${new Date(Date.UTC(r.payroll_year, r.payroll_month, 0)).getUTCDate()}`,
        )
        .sort((a, b) =>
          String(b.effective_from).localeCompare(String(a.effective_from)),
        )[0];
      if (!s) return { ...r, lop_deduction: 0, adjusted_gross: 0 };
      const p = calculateMonthlyPayrollPreview({
        salaryStructure: s,
        payrollMonth: r.payroll_month,
        payrollYear: r.payroll_year,
        joiningDate: employee.date_of_joining,
        lopDays: r.lop_days,
        presentDays: r.present_days,
        paidLeaveDays: r.paid_leave_days,
        attendanceSettings: cfg.attendance,
        pfSettings: cfg.pf,
        ptSettings: cfg.pt,
      });
      return {
        ...r,
        lop_deduction: p.lopDeduction,
        adjusted_gross: p.grossSalary,
        net_salary: p.estimatedNetSalary,
      };
    });
    res.json({ employee, history: rows });
  } catch (e) {
    res.status(400).json({
      error:
        e instanceof Error ? e.message : "Unable to load attendance history",
    });
  }
});

router.get("/", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id)),
      m = periodSchema.parse({ month: req.query.month, year: req.query.year });
    if (!(await getContext(req, companyId)))
      return res.status(403).json({ error: "Company access denied" });
    const cfg = await getPayrollSettings(companyId);
    const { employees, salaryByEmployee, recordByEmployee } =
      await getEmployeesAndSalary(companyId, m.month, m.year, cfg);
    const department = String(req.query.department_id ?? "");
    const search = String(req.query.search ?? "")
      .trim()
      .toLowerCase();
    const rows = employees
      .filter((e: any) => !department || e.department_id === department)
      .filter(
        (e: any) =>
          !search ||
          `${e.employee_id} ${e.first_name} ${e.last_name}`
            .toLowerCase()
            .includes(search),
      )
      .map((e: any) => {
        const s = salaryByEmployee.get(e.id);
        const r = recordByEmployee.get(e.id);
        const preview = s
          ? calculateMonthlyPayrollPreview({
              salaryStructure: s,
              payrollMonth: m.month,
              payrollYear: m.year,
              joiningDate: e.date_of_joining,
              lopDays: Number(r?.lop_days ?? 0),
              presentDays: r ? Number(r.present_days) : undefined,
              paidLeaveDays: r ? Number(r.paid_leave_days) : undefined,
              attendanceSettings: cfg.attendance,
              pfSettings: cfg.pf,
              ptSettings: cfg.pt,
            })
          : null;
        return {
          employee: e,
          salary: s ?? null,
          record: r ?? null,
          preview,
          error: s
            ? null
          : "Annual CTC is missing for this employee. Add it in the employee profile.",
        };
      });
    const summary = {
      totalEmployees: rows.length,
      employeesWithLop: rows.filter((r) => (r.preview?.lopDays ?? 0) > 0)
        .length,
      totalLopDays: rows.reduce((n, r) => n + (r.preview?.lopDays ?? 0), 0),
      originalGross: rows.reduce(
        (n, r) => n + (r.preview?.originalGross ?? 0),
        0,
      ),
      totalLopDeduction: rows.reduce(
        (n, r) => n + (r.preview?.lopDeduction ?? 0),
        0,
      ),
      adjustedGross: rows.reduce(
        (n, r) => n + (r.preview?.grossSalary ?? 0),
        0,
      ),
    };
    res.json({
      month: m.month,
      year: m.year,
      settings: cfg.attendance,
      rows,
      summary,
    });
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : "Unable to load attendance",
    });
  }
});

async function validateRows(
  companyId: string,
  month: number,
  year: number,
  rows: z.infer<typeof bulkSchema>["rows"],
) {
  const cfg = await getPayrollSettings(companyId);
  const { employees, salaryByEmployee } = await getEmployeesAndSalary(
    companyId,
    month,
    year,
    cfg,
  );
  const byId = new Map(employees.map((e: any) => [e.id, e]));
  const errors: any[] = [];
  const seen = new Set<string>();
  const valid: any[] = [];
  for (const [index, row] of rows.entries()) {
    if (seen.has(row.employee_id)) {
      errors.push({
        row: index + 2,
        employee_id: row.employee_id,
        error: "Duplicate employee ID in import",
      });
      continue;
    }
    seen.add(row.employee_id);
    const employee = byId.get(row.employee_id);
    if (!employee) {
      errors.push({
        row: index + 2,
        employee_id: row.employee_id,
        error: "Unknown or inactive employee",
      });
      continue;
    }
    const salary = salaryByEmployee.get(row.employee_id);
    try {
      const preview = calculateMonthlyPayrollPreview({
        salaryStructure: salary ?? {
          annual_ctc: 0,
          monthly_ctc: 0,
          basic_salary: 0,
          special_allowance: 0,
          gross_salary: 0,
          employee_pf: 0,
          employer_pf: 0,
          professional_tax: 0,
        },
        payrollMonth: month,
        payrollYear: year,
        joiningDate: employee.date_of_joining,
        lopDays: row.lop_days,
        presentDays: row.present_days,
        paidLeaveDays: row.paid_leave_days,
        attendanceSettings: cfg.attendance,
        pfSettings: cfg.pf,
        ptSettings: cfg.pt,
      });
      valid.push({ employee, row, preview });
    } catch (e) {
      errors.push({
        row: index + 2,
        employee_id: employee.employee_id,
        error: e instanceof Error ? e.message : "Invalid attendance",
      });
    }
  }
  return { cfg, valid, errors };
}

function parseMonthValue(
  value: unknown,
): { month: number; year: number } | null {
  const s = String(value ?? "").trim();
  const m = s.match(/^(\d{4})[-/](\d{1,2})$/);
  if (m) return { year: Number(m[1]), month: Number(m[2]) };
  const d = new Date(s);
  if (!Number.isNaN(d.getTime()))
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  const name = s.match(
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/i,
  );
  if (name)
    return {
      year: Number(name[2]),
      month: new Date(`${name[1]} 1, ${name[2]}`).getMonth() + 1,
    };
  return null;
}

async function parseWorkbook(
  file: Express.Multer.File,
  month: number,
  year: number,
) {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(file.buffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Excel workbook contains no worksheets.");
  const first = wb.Sheets[sheetName];
  if (!first) throw new Error("Excel workbook contains no worksheets.");
  const rows: any[] = XLSX.utils.sheet_to_json(first, { defval: "" });
  const out: any[] = [];
  const errors: any[] = [];
  for (const [i, r] of rows.entries()) {
    const rowNo = i + 2;
    const employeeId = String(r["Employee ID"] ?? "").trim();
    const p = Number(r["Present Days"]);
    const l = Number(r["Paid Leave"]);
    const lop = Number(r["LOP Days"]);
    const period = parseMonthValue(r["Payroll Month"]);
    if (!employeeId)
      errors.push({ row: rowNo, error: "Employee ID is required" });
    if (!period || period.month !== month || period.year !== year)
      errors.push({
        row: rowNo,
        error: "Payroll Month does not match selected period",
      });
    if (
      !Number.isFinite(p) ||
      p < 0 ||
      !Number.isFinite(l) ||
      l < 0 ||
      !Number.isFinite(lop) ||
      lop < 0
    )
      errors.push({
        row: rowNo,
        employee_id: employeeId,
        error: "Attendance days must be non-negative numbers",
      });
    out.push({
      employee_id: employeeId,
      present_days: p,
      paid_leave_days: l,
      lop_days: lop,
    });
  }
  return { rows: out, errors };
}

router.post(
  "/import-preview",
  upload.single("file"),
  async (req: AuthRequest, res) => {
    try {
      const companyId = uuid.parse(String(req.query.company_id));
      const m = periodSchema.parse({
        month: req.query.month,
        year: req.query.year,
      });
      const membership = await getContext(req, companyId);
      if (
        !membership ||
        !["OWNER", "COMPANY_ADMIN", "HR", "ACCOUNTANT"].includes(
          membership.role,
        )
      )
        return res.status(403).json({ error: "Insufficient permissions" });
      await assertPayrollPeriodOpen(companyId, m.month, m.year);
      if (!req.file)
        return res.status(400).json({ error: "Excel file is required" });
      const parsed = await parseWorkbook(req.file, m.month, m.year);
      const numericRows = parsed.rows.filter(
        (r: any) =>
          Number.isFinite(r.present_days) &&
          Number.isFinite(r.paid_leave_days) &&
          Number.isFinite(r.lop_days),
      );
      const checked = await validateRows(
        companyId,
        m.month,
        m.year,
        numericRows,
      );
      res.json({
        imported: parsed.rows.length,
        valid: checked.valid.length,
        errors: [...parsed.errors, ...checked.errors],
        validRows: checked.valid.map((x: any) => x.row),
      });
    } catch (e) {
      res.status(400).json({
        error:
          e instanceof Error
            ? e.message
            : "Unable to preview attendance import",
      });
    }
  },
);

router.post("/import", async (req: AuthRequest, res) => {
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({
      error: "Invalid attendance import",
      details: parsed.error.flatten(),
    });
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = periodSchema.parse({
      month: req.query.month,
      year: req.query.year,
    });
    const membership = await getContext(req, companyId);
    if (
      !membership ||
      !["OWNER", "COMPANY_ADMIN", "HR", "ACCOUNTANT"].includes(membership.role)
    )
      return res.status(403).json({ error: "Insufficient permissions" });
    await assertPayrollPeriodOpen(companyId, m.month, m.year);
    const checked = await validateRows(
      companyId,
      m.month,
      m.year,
      parsed.data.rows,
    );
    if (checked.errors.length)
      return res.status(422).json({
        error: "Attendance import contains errors",
        valid: checked.valid.length,
        errors: checked.errors,
      });
    await saveRows(companyId, m.month, m.year, checked.valid, req.userId!);
    await writeAudit(
      companyId,
      req.userId!,
      "ATTENDANCE_MODIFIED",
      "ATTENDANCE",
      null,
      {
        payroll_month: m.month,
        payroll_year: m.year,
        row_count: checked.valid.length,
      },
    );
    res.json({ message: "Attendance imported", count: checked.valid.length });
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : "Unable to import attendance",
    });
  }
});

async function saveRows(
  companyId: string,
  month: number,
  year: number,
  items: any[],
  userId: string,
) {
  for (const item of items) {
    const existing = await admin
      .from("attendance_records")
      .select("id,lop_days")
      .eq("company_id", companyId)
      .eq("employee_id", item.employee.id)
      .eq("payroll_month", month)
      .eq("payroll_year", year)
      .maybeSingle();
    if (existing.error) throw existing.error;
    const r = item.row;
    const payload = {
      company_id: companyId,
      employee_id: item.employee.id,
      payroll_month: month,
      payroll_year: year,
      working_days: item.preview.workingDays,
      present_days: r.present_days,
      paid_leave_days: r.paid_leave_days,
      lop_days: r.lop_days,
      paid_days: item.preview.paidDays,
      eligible_days: item.preview.eligibleDays,
      status: "PROCESSED",
    };
    const { error } = await admin.from("attendance_records").upsert(payload, {
      onConflict: "company_id,employee_id,payroll_month,payroll_year",
    });
    if (error) throw error;
    if (
      existing.data &&
      Number(existing.data.lop_days) !== Number(r.lop_days)
    ) {
      await admin.from("audit_logs").insert({
        company_id: companyId,
        user_id: userId,
        action: "LOP_CHANGED",
        entity_type: "attendance_record",
        entity_id: existing.data.id,
        metadata: {
          employee_id: item.employee.employee_id,
          payroll_month: month,
          payroll_year: year,
          old_lop: Number(existing.data.lop_days),
          new_lop: Number(r.lop_days),
        },
      });
    }
  }
}

router.put("/", async (req: AuthRequest, res) => {
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({
      error: "Invalid attendance data",
      details: parsed.error.flatten(),
    });
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = periodSchema.parse({
      month: req.query.month,
      year: req.query.year,
    });
    const membership = await getContext(req, companyId);
    if (
      !membership ||
      !["OWNER", "COMPANY_ADMIN", "HR", "ACCOUNTANT"].includes(membership.role)
    )
      return res.status(403).json({ error: "Insufficient permissions" });
    await assertPayrollPeriodOpen(companyId, m.month, m.year);
    const checked = await validateRows(
      companyId,
      m.month,
      m.year,
      parsed.data.rows,
    );
    if (checked.errors.length)
      return res.status(422).json({
        error: "Attendance validation failed",
        errors: checked.errors,
      });
    await saveRows(companyId, m.month, m.year, checked.valid, req.userId!);
    await writeAudit(
      companyId,
      req.userId!,
      "ATTENDANCE_MODIFIED",
      "ATTENDANCE",
      null,
      {
        payroll_month: m.month,
        payroll_year: m.year,
        row_count: checked.valid.length,
      },
    );
    res.json({ message: "Attendance saved", count: checked.valid.length });
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : "Unable to save attendance",
    });
  }
});

export default router;
