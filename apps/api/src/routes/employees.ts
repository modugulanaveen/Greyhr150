import { Router } from "express";
import multer from "multer";
import archiver from "archiver";
import * as XLSX from "xlsx";
import { z } from "zod";
import { admin } from "../lib/supabase.js";
import { writeAudit } from "../lib/audit.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import {
  canEdit,
  canView,
  canViewSensitive,
  getMembership,
} from "../lib/authorization.js";
const router = Router();
router.use(requireAuth);
const uuid = z.string().uuid();
const employeeSchema = z
  .object({
    employee_id: z.string().trim().min(1).max(50),
    first_name: z.string().trim().min(1).max(100),
    last_name: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(255).nullable().optional(),
    mobile: z.string().trim().max(30).nullable().optional(),
    date_of_birth: z.string().date().nullable().optional(),
    gender: z.string().trim().max(30).nullable().optional(),
    residential_address: z.string().trim().max(1000).nullable().optional(),
    emergency_contact_name: z.string().trim().max(150).nullable().optional(),
    emergency_contact_phone: z.string().trim().max(30).nullable().optional(),
    date_of_joining: z.string().date(),
    department_id: uuid.nullable().optional(),
    department_name: z.string().trim().max(100).nullable().optional(),
    designation: z.string().trim().max(120).nullable().optional(),
    employment_type: z
      .enum(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN", "CONSULTANT"])
      .default("FULL_TIME"),
    reporting_manager: z.string().trim().max(150).nullable().optional(),
    employment_status: z
      .enum(["ACTIVE", "INACTIVE", "ON_NOTICE", "TERMINATED"])
      .default("ACTIVE"),
    last_working_date: z.string().date().nullable().optional(),
    work_location: z.string().trim().max(150).nullable().optional(),
    annual_ctc: z.number().nonnegative().nullable().optional(),
    salary_effective_date: z.string().date().nullable().optional(),
    salary_payment_frequency: z
      .enum(["MONTHLY", "WEEKLY", "BIWEEKLY"])
      .default("MONTHLY"),
    salary_structure_assignment: z
      .string()
      .trim()
      .max(150)
      .nullable()
      .optional(),
    pf_applicable: z.boolean().default(true),
    pt_applicable: z.boolean().default(true),
    tds_applicable: z.boolean().default(true),
    bank_account_holder_name: z.string().trim().max(150).nullable().optional(),
    bank_name: z.string().trim().max(150).nullable().optional(),
    account_number: z.string().trim().max(50).nullable().optional(),
    ifsc: z.string().trim().max(20).nullable().optional(),
    pan: z.string().trim().max(20).nullable().optional(),
    uan: z.string().trim().max(30).nullable().optional(),
    pf_member_id: z.string().trim().max(50).nullable().optional(),
    aadhaar_reference: z.string().trim().max(100).nullable().optional(),
    previous_employer_name: z.string().trim().max(200).nullable().optional(),
    previous_employer_taxable_salary: z
      .number()
      .nonnegative()
      .nullable()
      .optional(),
    previous_employer_tds: z.number().nonnegative().nullable().optional(),
    previous_employment_start_date: z.string().date().nullable().optional(),
    previous_employment_end_date: z.string().date().nullable().optional(),
  })
  .strict();
const deptSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    code: z.string().trim().max(30).nullable().optional(),
  })
  .strict();
function employeePersistenceError(error: unknown) {
  const dbError = error as { code?: string; message?: string };
  switch (dbError?.code) {
    case "42P01":
    case "42703":
    case "PGRST204":
    case "PGRST205": {
      const detail = dbError.message?.replace(/[\r\n]+/g, " ").slice(0, 180);
      return `Employee database schema mismatch (${dbError.code})${detail ? `: ${detail}` : "."}`;
    }
    case "23503":
      return "A related record prevents this change. Employees with payroll history must be marked Resigned instead of deleted.";
    case "23505":
      return "An employee with this ID already exists in this company.";
    case "23514":
      return "Some employee details do not meet the database requirements. Check the dates and selected values.";
    default:
      return "Unable to save employee changes. Check the API and Supabase configuration, then try again.";
  }
}
function mask(v: string | null | undefined, keep = 4) {
  if (!v) return null;
  return "•".repeat(Math.max(0, v.length - keep)) + v.slice(-keep);
}
async function context(req: AuthRequest, companyId: string) {
  const m = await getMembership(req.userId!, companyId);
  if (!m || !canView(m.role)) return null;
  return m;
}
async function employeePayload(
  companyId: string,
  body: any,
  existingId?: string,
) {
  let departmentId = body.department_id ?? null;
  if (body.department_name !== undefined) {
    const departmentName = body.department_name?.trim();
    departmentId = null;
    if (departmentName) {
      const { data, error } = await admin
        .from("departments")
        .upsert(
          { company_id: companyId, name: departmentName },
          { onConflict: "company_id,name", ignoreDuplicates: true },
        )
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (data) departmentId = data.id;
      else {
        const { data: existing, error: lookupError } = await admin
          .from("departments")
          .select("id")
          .eq("company_id", companyId)
          .eq("name", departmentName)
          .single();
        if (lookupError) throw lookupError;
        departmentId = existing.id;
      }
    }
  }
  const e = {
    company_id: companyId,
    employee_id: body.employee_id,
    first_name: body.first_name,
    last_name: body.last_name,
    email: body.email ?? null,
    mobile: body.mobile ?? null,
    date_of_birth: body.date_of_birth ?? null,
    gender: body.gender ?? null,
    residential_address: body.residential_address ?? null,
    emergency_contact_name: body.emergency_contact_name ?? null,
    emergency_contact_phone: body.emergency_contact_phone ?? null,
    date_of_joining: body.date_of_joining,
    department_id: departmentId,
    designation: body.designation ?? null,
    employment_type: body.employment_type,
    reporting_manager: body.reporting_manager ?? null,
    employment_status: body.employment_status,
    last_working_date: body.last_working_date ?? null,
    work_location: body.work_location ?? null,
  };
  if (existingId) {
    const { error } = await admin
      .from("employees")
      .update(e)
      .eq("id", existingId)
      .eq("company_id", companyId);
    if (error) throw error;
  } else {
    const { data, error } = await admin
      .from("employees")
      .insert(e)
      .select("id")
      .single();
    if (error) throw error;
    existingId = data.id;
  }
  const id = existingId!;
  // Sensitive values are intentionally not prefilled in the edit form. An
  // empty field therefore means "leave the stored value alone" on updates.
  const [existingBank, existingStatutory] = existingId
    ? await Promise.all([
        admin
          .from("employee_bank_details")
          .select("account_holder_name,bank_name,account_number,ifsc")
          .eq("company_id", companyId)
          .eq("employee_id", id)
          .maybeSingle(),
        admin
          .from("employee_statutory_details")
          .select("pan,uan,pf_member_id,aadhaar_reference")
          .eq("company_id", companyId)
          .eq("employee_id", id)
          .maybeSingle(),
      ])
    : [null, null];
  if (existingBank?.error) throw existingBank.error;
  if (existingStatutory?.error) throw existingStatutory.error;
  const keepWhenBlank = (
    incoming: string | null | undefined,
    stored: string | null | undefined,
  ) => (incoming?.trim() ? incoming.trim() : (stored ?? null));
  const salary = {
    employee_id: id,
    company_id: companyId,
    annual_ctc: body.annual_ctc ?? null,
    effective_from: body.salary_effective_date ?? body.date_of_joining,
    payment_frequency: body.salary_payment_frequency,
    pf_applicable: body.pf_applicable ?? true,
    pt_applicable: body.pt_applicable ?? true,
    tds_applicable: body.tds_applicable ?? true,
  };
  if (body.salary_effective_date || body.annual_ctc !== undefined) {
    const { error } = await admin
      .from("employee_salary_assignments")
      .upsert(salary, { onConflict: "employee_id,effective_from" });
    if (error) throw error;
  }
  const { error: be } = await admin.from("employee_bank_details").upsert(
    {
      employee_id: id,
      company_id: companyId,
      account_holder_name: keepWhenBlank(
        body.bank_account_holder_name,
        existingBank?.data?.account_holder_name,
      ),
      bank_name: keepWhenBlank(body.bank_name, existingBank?.data?.bank_name),
      account_number: keepWhenBlank(
        body.account_number,
        existingBank?.data?.account_number,
      ),
      ifsc: keepWhenBlank(body.ifsc, existingBank?.data?.ifsc),
    },
    { onConflict: "employee_id" },
  );
  if (be) throw be;
  const { error: se } = await admin.from("employee_statutory_details").upsert(
    {
      employee_id: id,
      company_id: companyId,
      pan: keepWhenBlank(body.pan, existingStatutory?.data?.pan),
      uan: keepWhenBlank(body.uan, existingStatutory?.data?.uan),
      pf_member_id: keepWhenBlank(
        body.pf_member_id,
        existingStatutory?.data?.pf_member_id,
      ),
      aadhaar_reference: keepWhenBlank(
        body.aadhaar_reference,
        existingStatutory?.data?.aadhaar_reference,
      ),
    },
    { onConflict: "employee_id" },
  );
  if (se) throw se;
  const { error: pe } = await admin.from("employee_previous_employment").upsert(
    {
      employee_id: id,
      company_id: companyId,
      employer_name: body.previous_employer_name ?? null,
      taxable_salary: body.previous_employer_taxable_salary ?? null,
      tds_deducted: body.previous_employer_tds ?? null,
      employment_start_date: body.previous_employment_start_date ?? null,
      employment_end_date: body.previous_employment_end_date ?? null,
    },
    { onConflict: "employee_id" },
  );
  if (pe) throw pe;
  return id;
}
async function fullEmployee(companyId: string, id: string, sensitive: boolean) {
  const { data, error } = await admin
    .from("employees")
    .select("*, departments(name)")
    .eq("company_id", companyId)
    .eq("id", id)
    .single();
  if (error) throw error;
  const [s, b, st, p, d] = await Promise.all([
    admin
      .from("employee_salary_assignments")
      .select("*")
      .eq("company_id", companyId)
      .eq("employee_id", id)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("employee_bank_details")
      .select("*")
      .eq("company_id", companyId)
      .eq("employee_id", id)
      .maybeSingle(),
    admin
      .from("employee_statutory_details")
      .select("*")
      .eq("company_id", companyId)
      .eq("employee_id", id)
      .maybeSingle(),
    admin
      .from("employee_previous_employment")
      .select("*")
      .eq("company_id", companyId)
      .eq("employee_id", id)
      .maybeSingle(),
    admin
      .from("employee_documents")
      .select("id,document_type,original_name,mime_type,file_size,created_at")
      .eq("company_id", companyId)
      .eq("employee_id", id)
      .order("created_at", { ascending: false }),
  ]);
  if (s.error || b.error || st.error || p.error || d.error)
    throw (s.error || b.error || st.error || p.error || d.error)!;
  const bank = sensitive
    ? b.data
    : {
        account_holder_name: b.data?.account_holder_name ?? null,
        bank_name: b.data?.bank_name ?? null,
        account_number: b.data?.account_number
          ? mask(b.data.account_number)
          : null,
        ifsc: b.data?.ifsc ? mask(b.data.ifsc, 4) : null,
      };
  const statutory = sensitive
    ? st.data
    : {
        pan: st.data?.pan ? mask(st.data.pan, 4) : null,
        uan: st.data?.uan ? mask(st.data.uan, 4) : null,
        pf_member_id: st.data?.pf_member_id
          ? mask(st.data.pf_member_id, 4)
          : null,
        aadhaar_reference: "Not displayed",
      };
  return {
    ...data,
    department_name: (data as any).departments?.name ?? null,
    departments: undefined,
    salary: s.data ?? null,
    bank,
    statutory,
    previous_employment: p.data ?? null,
    documents: d.data ?? [],
  };
}
router.get("/departments", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await context(req, companyId);
    if (!m) return res.status(403).json({ error: "Company access denied" });
    const { data, error } = await admin
      .from("departments")
      .select("*")
      .eq("company_id", companyId)
      .order("name");
    if (error) throw error;
    res.json({ departments: data ?? [] });
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : "Unable to load departments",
    });
  }
});
router.post("/departments", async (req: AuthRequest, res) => {
  const p = deptSchema.safeParse(req.body);
  if (!p.success)
    return res.status(400).json({ error: "Invalid department details" });
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await context(req, companyId);
    if (!m || !canEdit(m.role))
      return res.status(403).json({ error: "Insufficient permissions" });
    const { data, error } = await admin
      .from("departments")
      .insert({ company_id: companyId, ...p.data })
      .select("*")
      .single();
    if (error) throw error;
    res.status(201).json({ department: data });
  } catch (e) {
    res.status(400).json({ error: "Unable to create department" });
  }
});
router.get("/export", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await context(req, companyId);
    if (!m) return res.status(403).json({ error: "Company access denied" });
    const { data, error } = await admin
      .from("employees")
      .select(
        "employee_id,first_name,last_name,email,mobile,date_of_joining,employment_type,employment_status,designation,work_location,departments(name)",
      )
      .eq("company_id", companyId)
      .order("employee_id");
    if (error) throw error;
    const rows = (data ?? []).map((e: any) => ({
      "Employee ID": e.employee_id,
      "First Name": e.first_name,
      "Last Name": e.last_name,
      Email: e.email ?? "",
      Mobile: e.mobile ?? "",
      "Joining Date": e.date_of_joining,
      Department: e.departments?.name ?? "",
      Designation: e.designation ?? "",
      "Employment Type": e.employment_type,
      Status: e.employment_status,
      "Work Location": e.work_location ?? "",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(rows),
      "Employees",
    );
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="paymate-employees.xlsx"',
    );
    res.send(buf);
  } catch (e) {
    res.status(400).json({ error: "Unable to export employees" });
  }
});
router.get("/", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await context(req, companyId);
    if (!m) return res.status(403).json({ error: "Company access denied" });
    const page = Math.max(1, Number(req.query.page) || 1),
      limit = Math.min(100, Math.max(1, Number(req.query.limit) || 10)),
      search = String(req.query.search ?? "").trim(),
      status = String(req.query.status ?? ""),
      department = String(req.query.department_id ?? ""),
      sort = String(req.query.sort ?? "created_at"),
      dir = String(req.query.dir ?? "desc") === "asc";
    let q = admin
      .from("employees")
      .select("*, departments(name)", { count: "exact" })
      .eq("company_id", companyId);
    if (search) {
      const safeSearch = search.replace(/[^a-zA-Z0-9@._ -]/g, " ").slice(0, 80);
      const { data: searchDepartments } = await admin
        .from("departments")
        .select("id")
        .eq("company_id", companyId)
        .ilike("name", `%${safeSearch}%`);
      const deptParts = (searchDepartments ?? []).map(
        (d: any) => `department_id.eq.${d.id}`,
      );
      q = q.or(
        `employee_id.ilike.%${safeSearch}%,first_name.ilike.%${safeSearch}%,last_name.ilike.%${safeSearch}%,designation.ilike.%${safeSearch}%${deptParts.length ? "," + deptParts.join(",") : ""}`,
      );
    }
    if (status) q = q.eq("employment_status", status);
    if (department) q = q.eq("department_id", department);
    const allowed = [
      "employee_id",
      "first_name",
      "last_name",
      "date_of_joining",
      "employment_status",
      "created_at",
    ];
    q = q
      .order(allowed.includes(sort) ? sort : "created_at", { ascending: dir })
      .range((page - 1) * limit, page * limit - 1);
    const { data, error, count } = await q;
    if (error) throw error;
    const [{ count: active }, { count: onNotice }, { count: separated }] =
      await Promise.all([
        admin
          .from("employees")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("employment_status", "ACTIVE"),
        admin
          .from("employees")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("employment_status", "ON_NOTICE"),
        admin
          .from("employees")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .in("employment_status", ["TERMINATED", "INACTIVE"]),
      ]);
    res.json({
      employees: (data ?? []).map((e: any) => ({
        ...e,
        department_name: e.departments?.name ?? null,
        departments: undefined,
      })),
      pagination: {
        page,
        limit,
        total: count ?? 0,
        total_pages: Math.ceil((count ?? 0) / limit),
      },
      summary: {
        total: count ?? 0,
        active: active ?? 0,
        onNotice: onNotice ?? 0,
        separated: separated ?? 0,
      },
    });
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : "Unable to load employees",
    });
  }
});
router.get("/:id", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await context(req, companyId);
    if (!m) return res.status(403).json({ error: "Company access denied" });
    const employeeId = uuid.parse(req.params.id);
    res.json({
      employee: await fullEmployee(
        companyId,
        employeeId,
        canViewSensitive(m.role),
      ),
    });
  } catch (e) {
    res.status(404).json({ error: "Employee not found" });
  }
});
router.post("/", async (req: AuthRequest, res) => {
  const p = employeeSchema.safeParse(req.body);
  if (!p.success)
    return res.status(400).json({
      error: "Invalid employee details",
      details: p.error.flatten().fieldErrors,
    });
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await context(req, companyId);
    if (!m || !canEdit(m.role))
      return res.status(403).json({ error: "Insufficient permissions" });
    const { data: dup } = await admin
      .from("employees")
      .select("id")
      .eq("company_id", companyId)
      .eq("employee_id", p.data.employee_id)
      .maybeSingle();
    if (dup)
      return res
        .status(409)
        .json({ error: "Employee ID already exists in this company" });
    const id = await employeePayload(companyId, p.data);
    await writeAudit(
      companyId,
      req.userId!,
      "EMPLOYEE_CREATED",
      "EMPLOYEE",
      id,
      { employee_id: p.data.employee_id },
    );
    res.status(201).json({ employee: await fullEmployee(companyId, id, true) });
  } catch (e) {
    const dbError = e as { code?: string; message?: string };
    console.error("Create employee failed", {
      code: dbError?.code,
      message: dbError?.message,
    });
    res.status(400).json({ error: employeePersistenceError(e) });
  }
});
router.put("/:id", async (req: AuthRequest, res) => {
  const p = employeeSchema.safeParse(req.body);
  if (!p.success)
    return res.status(400).json({
      error: "Invalid employee details",
      details: p.error.flatten().fieldErrors,
    });
  try {
    const companyId = uuid.parse(String(req.query.company_id)),
      id = uuid.parse(req.params.id);
    const m = await context(req, companyId);
    if (!m || !canEdit(m.role))
      return res.status(403).json({ error: "Insufficient permissions" });
    const { data: dup } = await admin
      .from("employees")
      .select("id")
      .eq("company_id", companyId)
      .eq("employee_id", p.data.employee_id)
      .neq("id", id)
      .maybeSingle();
    if (dup)
      return res
        .status(409)
        .json({ error: "Employee ID already exists in this company" });
    const { data: exists } = await admin
      .from("employees")
      .select("id")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!exists) return res.status(404).json({ error: "Employee not found" });
    await employeePayload(companyId, p.data, id);
    await writeAudit(
      companyId,
      req.userId!,
      "EMPLOYEE_UPDATED",
      "EMPLOYEE",
      id,
      { employee_id: p.data.employee_id },
    );
    res.json({ employee: await fullEmployee(companyId, id, true) });
  } catch (e) {
    const dbError = e as { code?: string; message?: string };
    console.error("Update employee failed", {
      code: dbError?.code,
      message: dbError?.message,
    });
    res.status(400).json({ error: employeePersistenceError(e) });
  }
});
router.patch("/:id/status", async (req: AuthRequest, res) => {
  const status = z
    .enum(["ACTIVE", "ON_NOTICE", "TERMINATED"])
    .safeParse(req.body?.employment_status);
  if (!status.success)
    return res
      .status(400)
      .json({ error: "Choose Active, On Notice, or Resigned" });
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const id = uuid.parse(req.params.id);
    const m = await context(req, companyId);
    if (!m || !canEdit(m.role))
      return res.status(403).json({ error: "Insufficient permissions" });
    const { data: employee, error: lookupError } = await admin
      .from("employees")
      .select("id,employee_id")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    const { error: updateError } = await admin
      .from("employees")
      .update({ employment_status: status.data })
      .eq("id", id)
      .eq("company_id", companyId);
    if (updateError) throw updateError;
    await writeAudit(
      companyId,
      req.userId!,
      "EMPLOYEE_STATUS_UPDATED",
      "EMPLOYEE",
      id,
      { employee_id: employee.employee_id, employment_status: status.data },
    );
    res.json({ id, employment_status: status.data });
  } catch (e) {
    const dbError = e as { code?: string; message?: string };
    console.error("Update employee status failed", {
      code: dbError?.code,
      message: dbError?.message,
    });
    res.status(400).json({ error: employeePersistenceError(e) });
  }
});
router.delete("/:id", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id)),
      id = uuid.parse(req.params.id);
    const m = await context(req, companyId);
    if (!m || !canEdit(m.role))
      return res.status(403).json({ error: "Insufficient permissions" });
    const { data: employee, error: lookupError } = await admin
      .from("employees")
      .select("id,employee_id")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    const { data: documents, error: documentError } = await admin
      .from("employee_documents")
      .select("storage_path")
      .eq("employee_id", id)
      .eq("company_id", companyId);
    if (documentError) throw documentError;
    const { data: payslips, error: payslipError } = await admin
      .from("payslips")
      .select("file_path")
      .eq("employee_id", id)
      .eq("company_id", companyId);
    if (payslipError) throw payslipError;
    const dependentTables = [
      "payslips",
      "payroll_records",
      "payroll_adjustments",
      "payroll_validation_errors",
      "payroll_audit_logs",
      "employee_tax_profiles",
      "tds_calculations",
      "tds_monthly_schedule",
      "attendance_records",
      "salary_structures",
      "employee_salary_assignments",
    ];
    for (const table of dependentTables) {
      const { error } = await admin.from(table).delete().eq("employee_id", id);
      if (error) throw error;
    }
    const { error: deleteError } = await admin
      .from("employees")
      .delete()
      .eq("id", id)
      .eq("company_id", companyId);
    if (deleteError) throw deleteError;
    const documentPaths = (documents ?? []).map(
      (document: any) => document.storage_path,
    );
    const payslipPaths = (payslips ?? [])
      .map((payslip: any) => payslip.file_path)
      .filter((path: string | null): path is string => Boolean(path));
    const storageErrors: string[] = [];
    if (documentPaths.length) {
      const { error } = await admin.storage
        .from(process.env.SUPABASE_EMPLOYEE_BUCKET || "employee-documents")
        .remove(documentPaths);
      if (error) storageErrors.push(error.message);
    }
    if (payslipPaths.length) {
      const { error } = await admin.storage
        .from(process.env.SUPABASE_PAYSLIP_BUCKET || "payslips")
        .remove(payslipPaths);
      if (error) storageErrors.push(error.message);
    }
    await writeAudit(
      companyId,
      req.userId!,
      "EMPLOYEE_DELETED",
      "EMPLOYEE",
      id,
      { employee_id: employee.employee_id },
    );
    if (storageErrors.length)
      console.error("Employee deleted but file cleanup failed", storageErrors);
    res.json({ deleted: true, file_cleanup_pending: storageErrors.length > 0 });
  } catch (e) {
    const dbError = e as { code?: string; message?: string };
    console.error("Delete employee failed", {
      code: dbError?.code,
      message: dbError?.message,
    });
    res.status(400).json({ error: employeePersistenceError(e) });
  }
});
router.post("/:id/deactivate", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id)),
      id = uuid.parse(req.params.id);
    const m = await context(req, companyId);
    if (!m || !canEdit(m.role))
      return res.status(403).json({ error: "Insufficient permissions" });
    const { data, error } = await admin
      .from("employees")
      .update({
        employment_status: "INACTIVE",
        deactivated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("company_id", companyId)
      .select("id,employee_id,employment_status")
      .single();
    if (error) throw error;
    await writeAudit(
      companyId,
      req.userId!,
      "EMPLOYEE_DEACTIVATED",
      "EMPLOYEE",
      id,
      { employee_id: data.employee_id },
    );
    res.json({ employee: data });
  } catch (e) {
    res.status(404).json({ error: "Unable to deactivate employee" });
  }
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    cb(null, allowed.includes(file.mimetype));
  },
});
function validDocument(buffer: Buffer, mime: string) {
  if (mime === "application/pdf")
    return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mime === "image/png")
    return buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/jpeg")
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (
    mime ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return buffer.subarray(0, 2).toString("ascii") === "PK";
  return false;
}
router.post(
  "/:id/documents",
  upload.single("file"),
  async (req: AuthRequest, res) => {
    try {
      const companyId = uuid.parse(String(req.query.company_id)),
        id = uuid.parse(req.params.id);
      const m = await context(req, companyId);
      if (!m || !canEdit(m.role))
        return res.status(403).json({ error: "Insufficient permissions" });
      if (!req.file || !validDocument(req.file.buffer, req.file.mimetype))
        return res.status(400).json({ error: "Unsupported or invalid file" });
      const type = z
        .enum([
          "OFFER_LETTER",
          "PAN_DOCUMENT",
          "BANK_PROOF",
          "FORM_16",
          "FORM_12B",
          "OTHER",
        ])
        .parse(req.body.document_type);
      const path = `${companyId}/${id}/${crypto.randomUUID()}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: up } = await admin.storage
        .from(process.env.SUPABASE_EMPLOYEE_BUCKET || "employee-documents")
        .upload(path, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false,
        });
      if (up) throw up;
      const { data, error } = await admin
        .from("employee_documents")
        .insert({
          employee_id: id,
          company_id: companyId,
          document_type: type,
          original_name: req.file.originalname,
          storage_path: path,
          mime_type: req.file.mimetype,
          file_size: req.file.size,
          uploaded_by: req.userId!,
        })
        .select("id,document_type,original_name,mime_type,file_size,created_at")
        .single();
      if (error) throw error;
      await writeAudit(
        companyId,
        req.userId!,
        "EMPLOYEE_DOCUMENT_UPLOADED",
        "EMPLOYEE_DOCUMENT",
        data.id,
        { document_type: type },
      );
      res.status(201).json({ document: data });
    } catch (e) {
      res.status(400).json({ error: "Unable to upload document" });
    }
  },
);
router.get("/:id/documents/download-all", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const id = uuid.parse(req.params.id);
    const m = await context(req, companyId);
    if (!m || !canViewSensitive(m.role))
      return res.status(403).json({ error: "Document access restricted" });
    const { data: docs, error } = await admin
      .from("employee_documents")
      .select("storage_path,original_name")
      .eq("employee_id", id)
      .eq("company_id", companyId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    if (!docs?.length)
      return res.status(404).json({ error: "No employee documents found" });

    const { data: employee, error: employeeError } = await admin
      .from("employees")
      .select("employee_id")
      .eq("id", id)
      .eq("company_id", companyId)
      .single();
    if (employeeError) throw employeeError;
    const safeEmployeeId = String(employee.employee_id).replace(
      /[^a-zA-Z0-9_-]/g,
      "_",
    );
    const archive = archiver("zip", { zlib: { level: 6 } });
    res.attachment(`${safeEmployeeId}-documents.zip`);
    archive.on("error", (archiveError) => {
      if (!res.headersSent) res.status(500).end();
      else res.end();
      console.error("Employee document archive failed", archiveError);
    });
    archive.pipe(res);
    const usedNames = new Set<string>();
    for (const doc of docs) {
      const { data: file, error: downloadError } = await admin.storage
        .from(process.env.SUPABASE_EMPLOYEE_BUCKET || "employee-documents")
        .download(doc.storage_path);
      if (downloadError || !file)
        throw downloadError ?? new Error("Document unavailable");
      const originalName = String(doc.original_name || "document").replace(
        /[\\/:*?\"<>|]/g,
        "_",
      );
      let filename = originalName;
      let suffix = 1;
      while (usedNames.has(filename)) {
        suffix += 1;
        const dot = originalName.lastIndexOf(".");
        filename =
          dot > 0
            ? `${originalName.slice(0, dot)} (${suffix})${originalName.slice(dot)}`
            : `${originalName} (${suffix})`;
      }
      usedNames.add(filename);
      archive.append(Buffer.from(await file.arrayBuffer()), { name: filename });
    }
    await archive.finalize();
  } catch (e) {
    if (!res.headersSent)
      res.status(400).json({
        error: e instanceof Error ? e.message : "Unable to download documents",
      });
    else res.end();
  }
});

router.get(
  "/:id/documents/:documentId/download",
  async (req: AuthRequest, res) => {
    try {
      const companyId = uuid.parse(String(req.query.company_id)),
        id = uuid.parse(req.params.id),
        documentId = uuid.parse(req.params.documentId);
      const m = await context(req, companyId);
      if (!m || !canViewSensitive(m.role))
        return res.status(403).json({ error: "Document access restricted" });
      const { data: doc, error } = await admin
        .from("employee_documents")
        .select("storage_path")
        .eq("id", documentId)
        .eq("employee_id", id)
        .eq("company_id", companyId)
        .single();
      if (error) throw error;
      const { data: sign, error: se } = await admin.storage
        .from(process.env.SUPABASE_EMPLOYEE_BUCKET || "employee-documents")
        .createSignedUrl(doc.storage_path, 300);
      if (se) throw se;
      res.json({ url: sign.signedUrl, expires_in: 300 });
    } catch (e) {
      res.status(404).json({ error: "Document not found" });
    }
  },
);
export default router;
