import { Router } from "express";
import { z } from "zod";
import { admin } from "../lib/supabase.js";
import { writeAudit } from "../lib/audit.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { canEdit, canView, getMembership } from "../lib/authorization.js";
import {
  calculateSalaryStructure,
  type PfSettings,
  type PtSettings,
  type PtSlab,
} from "@paymate/shared";

const router = Router();
router.use(requireAuth);
const uuid = z.string().uuid();
const date = z.string().date();
const structureSchema = z.object({
  employee_id: uuid,
  annual_ctc: z.number().positive(),
  effective_from: date,
});
const DEFAULT_PF: PfSettings = {
  employeePfRate: 12,
  employerPfRate: 12,
  pfWageCeiling: 25000,
  minimumBasic: 20000,
  basicPercentage: 50,
  enabled: true,
};
const DEFAULT_PT: PtSettings = {
  enabled: true,
  state: null,
  slabs: [
    { min: 0, max: 15000, amount: 0 },
    { min: 15000.01, max: 20000, amount: 150 },
    { min: 20000.01, max: null, amount: 200 },
  ],
};

async function membership(req: AuthRequest, companyId: string) {
  const m = await getMembership(req.userId!, companyId);
  return m && canView(m.role) ? m : null;
}
async function settings(companyId: string) {
  const [pf, pt, payroll] = await Promise.all([
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
    admin
      .from("payroll_settings")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle(),
  ]);
  if (pf.error || pt.error || payroll.error)
    throw pf.error || pt.error || payroll.error;
  let pfRow = pf.data,
    ptRow = pt.data;
  if (!pfRow) {
    const { data, error } = await admin
      .from("pf_settings")
      .insert({ company_id: companyId, ...DEFAULT_PF })
      .select("*")
      .single();
    if (error) throw error;
    pfRow = data;
  }
  if (!ptRow) {
    const { data, error } = await admin
      .from("pt_settings")
      .insert({
        company_id: companyId,
        enabled: DEFAULT_PT.enabled,
        state: DEFAULT_PT.state,
        slabs: DEFAULT_PT.slabs,
      })
      .select("*")
      .single();
    if (error) throw error;
    ptRow = data;
  }
  if (!payroll.data) {
    const { error } = await admin
      .from("payroll_settings")
      .insert({ company_id: companyId, currency: "INR" });
    if (error) throw error;
  }
  return {
    pf: {
      enabled: pfRow.enabled,
      employeePfRate: Number(pfRow.employee_pf_rate),
      employerPfRate: Number(pfRow.employer_pf_rate),
      pfWageCeiling: Number(pfRow.pf_wage_ceiling),
      minimumBasic: Number(pfRow.minimum_basic),
      basicPercentage: Number(pfRow.basic_percentage),
    },
    pt: {
      enabled: ptRow.enabled,
      state: ptRow.state,
      slabs: (ptRow.slabs ?? []) as PtSlab[],
    },
  };
}
async function companyEmployee(companyId: string, employeeId: string) {
  const { data, error } = await admin
    .from("employees")
    .select("id,employee_id,first_name,last_name,employment_status")
    .eq("company_id", companyId)
    .eq("id", employeeId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
router.get("/dashboard", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    if (!(await membership(req, companyId)))
      return res.status(403).json({ error: "Company access denied" });
    const { data, error } = await admin
      .from("salary_structures")
      .select("monthly_ctc,gross_salary,employee_pf,employer_pf")
      .eq("company_id", companyId)
      .eq("status", "ACTIVE");
    if (error) throw error;
    const rows = data ?? [];
    res.json({
      totalEmployees: rows.length,
      totalMonthlyGross: rows.reduce((n, r) => n + Number(r.gross_salary), 0),
      employerPf: rows.reduce((n, r) => n + Number(r.employer_pf), 0),
      employeePf: rows.reduce((n, r) => n + Number(r.employee_pf), 0),
      estimatedPayrollCost: rows.reduce((n, r) => n + Number(r.monthly_ctc), 0),
    });
  } catch (e) {
    res
      .status(400)
      .json({
        error:
          e instanceof Error ? e.message : "Unable to load salary dashboard",
      });
  }
});
router.get("/employee/:employeeId/history", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id)),
      employeeId = uuid.parse(req.params.employeeId);
    if (!(await membership(req, companyId)))
      return res.status(403).json({ error: "Company access denied" });
    const employee = await companyEmployee(companyId, employeeId);
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    const { data, error } = await admin
      .from("salary_structures")
      .select("*")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .order("effective_from", { ascending: false });
    if (error) throw error;
    res.json({ employee, salaryHistory: data ?? [] });
  } catch (e) {
    res
      .status(400)
      .json({
        error: e instanceof Error ? e.message : "Unable to load salary history",
      });
  }
});
router.get("/export", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    if (!(await membership(req, companyId)))
      return res.status(403).json({ error: "Company access denied" });
    const { data, error } = await admin
      .from("salary_structures")
      .select(
        "annual_ctc,monthly_ctc,basic_salary,special_allowance,gross_salary,employee_pf,employer_pf,professional_tax,effective_from,status,employees(employee_id,first_name,last_name)",
      )
      .eq("company_id", companyId)
      .order("effective_from", { ascending: false });
    if (error) throw error;
    const XLSX = await import("xlsx");
    const rows = (data ?? []).map((r: any) => ({
      "Employee ID": r.employees?.employee_id ?? "",
      Employee:
        `${r.employees?.first_name ?? ""} ${r.employees?.last_name ?? ""}`.trim(),
      "Annual CTC": Number(r.annual_ctc),
      "Monthly CTC": Number(r.monthly_ctc),
      Basic: Number(r.basic_salary),
      "Special Allowance": Number(r.special_allowance),
      Gross: Number(r.gross_salary),
      "Employee PF": Number(r.employee_pf),
      "Employer PF": Number(r.employer_pf),
      PT: Number(r.professional_tax),
      "Effective From": r.effective_from,
      Status: r.status,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(rows),
      "Salary Structures",
    );
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="paymate-salary-structures.xlsx"',
    );
    res.send(buf);
  } catch (e) {
    res.status(400).json({ error: "Unable to export salary structures" });
  }
});
router.get("/:id", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id)),
      id = uuid.parse(req.params.id);
    if (!(await membership(req, companyId)))
      return res.status(403).json({ error: "Company access denied" });
    const { data, error } = await admin
      .from("salary_structures")
      .select("*, employees(employee_id,first_name,last_name)")
      .eq("company_id", companyId)
      .eq("id", id)
      .single();
    if (error) throw error;
    await writeAudit(companyId, req.userId!, "SALARY_UPDATED", "SALARY", id, {
      employee_id: data.employee_id,
    });
    res.json({ salaryStructure: data });
  } catch (e) {
    res.status(404).json({ error: "Salary structure not found" });
  }
});
router.get("/", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    if (!(await membership(req, companyId)))
      return res.status(403).json({ error: "Company access denied" });
    const page = Math.max(1, Number(req.query.page) || 1),
      limit = Math.min(100, Math.max(1, Number(req.query.limit) || 10)),
      search = String(req.query.search ?? "").trim(),
      status = String(req.query.status ?? "");
    let q = admin
      .from("salary_structures")
      .select(
        "*, employees(employee_id,first_name,last_name,employment_status)",
        { count: "exact" },
      )
      .eq("company_id", companyId);
    if (status) q = q.eq("status", status);
    if (search) {
      const s = search
        .replace(/[^a-zA-Z0-9 .-]/g, " ")
        .slice(0, 80)
        .trim();
      const { data: emps } = await admin
        .from("employees")
        .select("id")
        .eq("company_id", companyId)
        .or(
          `employee_id.ilike.%${s}%,first_name.ilike.%${s}%,last_name.ilike.%${s}%`,
        );
      const ids = (emps ?? []).map((e) => e.id);
      if (ids.length) q = q.in("employee_id", ids);
      else q = q.eq("employee_id", "00000000-0000-0000-0000-000000000000");
    }
    q = q
      .order("effective_from", { ascending: false })
      .range((page - 1) * limit, page * limit - 1);
    const { data, error, count } = await q;
    if (error) throw error;
    res.json({
      salaryStructures: data ?? [],
      pagination: {
        page,
        limit,
        total: count ?? 0,
        total_pages: Math.ceil((count ?? 0) / limit),
      },
    });
  } catch (e) {
    res
      .status(400)
      .json({
        error:
          e instanceof Error ? e.message : "Unable to load salary structures",
      });
  }
});
async function createStructure(
  companyId: string,
  employeeId: string,
  annualCtc: number,
  effectiveFrom: string,
) {
  const employee = await companyEmployee(companyId, employeeId);
  if (!employee) throw new Error("Employee not found");
  const { data: existing, error: ee } = await admin
    .from("salary_structures")
    .select("id")
    .eq("company_id", companyId)
    .eq("employee_id", employeeId)
    .eq("status", "ACTIVE")
    .maybeSingle();
  if (ee) throw ee;
  if (existing)
    throw new Error(
      "An active salary structure already exists. Use salary revision instead.",
    );
  const cfg = await settings(companyId);
  const calc = calculateSalaryStructure({
    annualCtc,
    pfSettings: cfg.pf,
    ptSettings: cfg.pt,
  });
  const { data, error } = await admin
    .from("salary_structures")
    .insert({
      company_id: companyId,
      employee_id: employeeId,
      annual_ctc: calc.annualCtc,
      monthly_ctc: calc.monthlyCtc,
      basic_salary: calc.basicSalary,
      special_allowance: calc.specialAllowance,
      gross_salary: calc.grossSalary,
      employee_pf: calc.employeePf,
      employer_pf: calc.employerPf,
      professional_tax: calc.professionalTax,
      effective_from: effectiveFrom,
      status: "ACTIVE",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
router.post("/", async (req: AuthRequest, res) => {
  const p = structureSchema.safeParse(req.body);
  if (!p.success)
    return res
      .status(400)
      .json({
        error: "Invalid salary structure",
        details: p.error.flatten().fieldErrors,
      });
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await membership(req, companyId);
    if (!m || !canEdit(m.role))
      return res.status(403).json({ error: "Insufficient permissions" });
    res
      .status(201)
      .json({
        salaryStructure: await createStructure(
          companyId,
          p.data.employee_id,
          p.data.annual_ctc,
          p.data.effective_from,
        ),
      });
  } catch (e) {
    res
      .status(400)
      .json({
        error:
          e instanceof Error ? e.message : "Unable to create salary structure",
      });
  }
});
router.put("/:id", async (req: AuthRequest, res) => {
  const p = structureSchema
    .partial({ annual_ctc: true, effective_from: true })
    .safeParse(req.body);
  if (!p.success)
    return res.status(400).json({ error: "Invalid salary structure" });
  try {
    const companyId = uuid.parse(String(req.query.company_id)),
      id = uuid.parse(req.params.id);
    const m = await membership(req, companyId);
    if (!m || !canEdit(m.role))
      return res.status(403).json({ error: "Insufficient permissions" });
    const { data: row, error: re } = await admin
      .from("salary_structures")
      .select("employee_id,status,effective_from,annual_ctc")
      .eq("company_id", companyId)
      .eq("id", id)
      .single();
    if (re) throw re;
    if (row.status !== "ACTIVE")
      return res
        .status(409)
        .json({
          error:
            "Historical salary structures cannot be edited. Create a salary revision instead.",
        });
    const cfg = await settings(companyId);
    const annual = p.data.annual_ctc ?? Number(row.annual_ctc),
      effective = p.data.effective_from ?? row.effective_from;
    const calc = calculateSalaryStructure({
      annualCtc: annual,
      pfSettings: cfg.pf,
      ptSettings: cfg.pt,
    });
    const { data, error } = await admin
      .from("salary_structures")
      .update({
        annual_ctc: calc.annualCtc,
        monthly_ctc: calc.monthlyCtc,
        basic_salary: calc.basicSalary,
        special_allowance: calc.specialAllowance,
        gross_salary: calc.grossSalary,
        employee_pf: calc.employeePf,
        employer_pf: calc.employerPf,
        professional_tax: calc.professionalTax,
        effective_from: effective,
      })
      .eq("company_id", companyId)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    await writeAudit(companyId, req.userId!, "SALARY_UPDATED", "SALARY", id, {
      employee_id: data.employee_id,
    });
    res.json({ salaryStructure: data });
  } catch (e) {
    res
      .status(400)
      .json({
        error:
          e instanceof Error ? e.message : "Unable to update salary structure",
      });
  }
});
router.post("/revision", async (req: AuthRequest, res) => {
  const p = structureSchema.safeParse(req.body);
  if (!p.success)
    return res
      .status(400)
      .json({
        error: "Invalid salary revision",
        details: p.error.flatten().fieldErrors,
      });
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await membership(req, companyId);
    if (!m || !canEdit(m.role))
      return res.status(403).json({ error: "Insufficient permissions" });
    const employee = await companyEmployee(companyId, p.data.employee_id);
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    const { data: current, error: ce } = await admin
      .from("salary_structures")
      .select("*")
      .eq("company_id", companyId)
      .eq("employee_id", p.data.employee_id)
      .eq("status", "ACTIVE")
      .maybeSingle();
    if (ce) throw ce;
    if (!current)
      return res
        .status(404)
        .json({ error: "No active salary structure exists for this employee" });
    if (p.data.effective_from <= current.effective_from)
      return res
        .status(400)
        .json({
          error:
            "Revision effective date must be after the current salary effective date",
        });
    const cfg = await settings(companyId);
    const calc = calculateSalaryStructure({
      annualCtc: p.data.annual_ctc,
      pfSettings: cfg.pf,
      ptSettings: cfg.pt,
    });
    const { data: newRow, error: ne } = await admin
      .from("salary_structures")
      .insert({
        company_id: companyId,
        employee_id: p.data.employee_id,
        annual_ctc: calc.annualCtc,
        monthly_ctc: calc.monthlyCtc,
        basic_salary: calc.basicSalary,
        special_allowance: calc.specialAllowance,
        gross_salary: calc.grossSalary,
        employee_pf: calc.employeePf,
        employer_pf: calc.employerPf,
        professional_tax: calc.professionalTax,
        effective_from: p.data.effective_from,
        status: "ACTIVE",
      })
      .select("*")
      .single();
    if (ne) throw ne;
    const { error: oldError } = await admin
      .from("salary_structures")
      .update({
        status: "CLOSED",
        effective_to: new Date(
          new Date(`${p.data.effective_from}T00:00:00Z`).getTime() - 86400000,
        )
          .toISOString()
          .slice(0, 10),
      })
      .eq("id", current.id)
      .eq("company_id", companyId);
    if (oldError) {
      await admin
        .from("salary_structures")
        .delete()
        .eq("id", newRow.id)
        .eq("company_id", companyId);
      throw oldError;
    }
    await writeAudit(
      companyId,
      req.userId!,
      "SALARY_REVISED",
      "SALARY",
      newRow.id,
      {
        employee_id: p.data.employee_id,
        previous_salary_id: current.id,
        effective_from: p.data.effective_from,
      },
    );
    res
      .status(201)
      .json({ salaryStructure: newRow, previousSalaryId: current.id });
  } catch (e) {
    res
      .status(400)
      .json({
        error:
          e instanceof Error ? e.message : "Unable to create salary revision",
      });
  }
});
export default router;
