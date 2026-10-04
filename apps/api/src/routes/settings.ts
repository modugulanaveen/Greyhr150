import { Router } from "express";
import multer from "multer";
import crypto from "node:crypto";
import { z } from "zod";
import { admin } from "../lib/supabase.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import {
  getMembership,
  isAdmin,
  hasPermission,
  permissionMatrix,
  type Permission,
} from "../lib/authorization.js";
import { writeAudit } from "../lib/audit.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = Router();
router.use(requireAuth);
const uuid = z.string().uuid();
const companyIdSchema = z.string().uuid();
const companySchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    legal_name: z.string().trim().min(2).max(200),
    trade_name: z.string().trim().max(200).nullable().optional(),
    company_email: z.string().email().nullable().optional().or(z.literal("")),
    phone: z.string().trim().max(50).nullable().optional(),
    website: z.string().url().max(200).nullable().optional().or(z.literal("")),
    address: z.string().trim().max(500).nullable().optional(),
    city: z.string().trim().max(100).nullable().optional(),
    state: z.string().trim().max(100).nullable().optional(),
    pin_code: z.string().trim().max(20).nullable().optional(),
    gstin: z.string().trim().max(20).nullable().optional(),
    pan: z.string().trim().max(20).nullable().optional(),
  })
  .strict();
const memberRole = z.enum(["OWNER", "COMPANY_ADMIN", "HR", "ACCOUNTANT"]);
const memberStatus = z.enum(["ACTIVE", "INVITED", "SUSPENDED", "DEACTIVATED"]);
const inviteSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().email().max(254),
    role: memberRole.refine((v) => v !== "OWNER", {
      message: "OWNER invitations are not supported",
    }),
  })
  .strict();
const updateMemberSchema = z
  .object({
    role: memberRole.optional(),
    status: memberStatus.optional(),
    display_name: z.string().trim().max(120).optional(),
  })
  .strict();
const ptSlabSchema = z
  .object({
    min: z.coerce.number().nonnegative(),
    max: z.coerce.number().nonnegative().nullable(),
    amount: z.coerce.number().nonnegative(),
  })
  .refine((v) => v.max === null || v.max >= v.min, {
    message: "PT slab maximum must be greater than or equal to minimum",
  });
const payrollSchema = z
  .object({
    minimum_basic: z.coerce.number().min(0).max(1e7),
    basic_percentage: z.coerce.number().min(0).max(100),
    pf_enabled: z.boolean(),
    employee_pf_rate: z.coerce.number().min(0).max(100),
    employer_pf_rate: z.coerce.number().min(0).max(100),
    pf_wage_ceiling: z.coerce.number().min(0).max(1e8),
    proration_basis: z.enum(["CALENDAR_DAYS", "WORKING_DAYS"]),
    pt_enabled: z.boolean(),
    pt_state: z.string().trim().max(100).nullable(),
    pt_slabs: z.array(ptSlabSchema).max(50),
    default_tax_regime: z.enum(["NEW", "OLD"]),
    currency: z.literal("INR"),
  })
  .strict();
const statutoryRuleSchema = z
  .object({
    id: z.string().uuid().optional(),
    statutory_type: z.enum(["PF", "PT", "TDS"]),
    effective_from: z.string().date(),
    effective_to: z.string().date().nullable().optional(),
    config: z.record(z.unknown()),
  })
  .strict();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    cb(null, ["image/png", "image/jpeg", "image/webp"].includes(file.mimetype)),
});

async function context(
  req: AuthRequest,
  companyId: string,
  permission: Permission = "VIEW",
) {
  const parsed = companyIdSchema.safeParse(companyId);
  if (!parsed.success) return null;
  const m = await getMembership(req.userId!, companyId);
  if (!m) return null;
  if (!hasPermission(m.role, "Settings", permission)) return null;
  return m;
}
async function adminContext(req: AuthRequest, companyId: string) {
  const m = await context(req, companyId, "EDIT");
  return m && isAdmin(m.role) ? m : null;
}
async function payrollSettingsContext(req: AuthRequest, companyId: string) {
  return context(req, companyId);
}
function extension(mime: string) {
  return mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
}
function validImage(buffer: Buffer, mime: string) {
  if (mime === "image/png")
    return (
      buffer.length > 8 &&
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    );
  if (mime === "image/jpeg")
    return (
      buffer.length > 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    );
  if (mime === "image/webp")
    return (
      buffer.length > 12 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP"
    );
  return false;
}

router.get("/company", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await adminContext(req, companyId);
    if (!m)
      return res
        .status(403)
        .json({ error: "Company settings require administrator permission" });
    const { data, error } = await admin
      .from("companies")
      .select("*")
      .eq("id", companyId)
      .single();
    if (error) throw error;
    res.json({ company: data, role: m.role });
  } catch (e) {
    res.status(400).json({ error: "Unable to load company settings" });
  }
});
router.put("/company", async (req: AuthRequest, res) => {
  const body = companySchema.safeParse(req.body);
  if (!body.success)
    return res.status(400).json({
      error: "Invalid company details",
      details: body.error.flatten().fieldErrors,
    });
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await adminContext(req, companyId);
    if (!m)
      return res
        .status(403)
        .json({ error: "Company settings require administrator permission" });
    const { data, error } = await admin
      .from("companies")
      .update(body.data)
      .eq("id", companyId)
      .select("*")
      .single();
    if (error) throw error;
    await writeAudit(
      companyId,
      req.userId!,
      "SETTINGS_UPDATED",
      "COMPANY",
      companyId,
      { fields: Object.keys(body.data) },
    );
    res.json({ company: data });
  } catch (e) {
    res.status(400).json({ error: "Unable to save company settings" });
  }
});
router.post(
  "/company/logo",
  rateLimit({ max: 10, keyPrefix: "settings-logo" }),
  upload.single("logo"),
  async (req: AuthRequest, res) => {
    try {
      const companyId = uuid.parse(String(req.query.company_id));
      const m = await adminContext(req, companyId);
      if (!m)
        return res
          .status(403)
          .json({ error: "Company settings require administrator permission" });
      if (!req.file || !validImage(req.file.buffer, req.file.mimetype))
        return res.status(400).json({ error: "Unsupported or invalid image" });
      const path = `${companyId}/logo-${crypto.randomUUID()}.${extension(req.file.mimetype)}`;
      const { error: up } = await admin.storage
        .from("company-branding")
        .upload(path, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false,
        });
      if (up) throw up;
      const { data, error } = await admin
        .from("companies")
        .update({ logo_path: path })
        .eq("id", companyId)
        .select("logo_path")
        .single();
      if (error) throw error;
      await writeAudit(
        companyId,
        req.userId!,
        "SETTINGS_UPDATED",
        "COMPANY",
        companyId,
        { fields: ["logo_path"] },
      );
      res.json({ logo_path: data.logo_path });
    } catch (e) {
      res.status(400).json({ error: "Unable to upload company logo" });
    }
  },
);
router.get("/company/logo", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await context(req, companyId);
    if (!m) return res.status(403).json({ error: "Company access denied" });
    const { data: company, error } = await admin
      .from("companies")
      .select("logo_path")
      .eq("id", companyId)
      .single();
    if (error) throw error;
    if (!company.logo_path) return res.json({ url: null });
    const { data, error: se } = await admin.storage
      .from("company-branding")
      .createSignedUrl(company.logo_path, 300);
    if (se) throw se;
    res.json({ url: data.signedUrl, expires_in: 300 });
  } catch (e) {
    res.status(404).json({ error: "Company logo not found" });
  }
});

router.get("/payroll", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await context(req, companyId);
    if (!m) return res.status(403).json({ error: "Company access denied" });
    const [
      { data: payroll },
      { data: pf },
      { data: attendance },
      { data: pt },
    ] = await Promise.all([
      admin
        .from("payroll_settings")
        .select("*")
        .eq("company_id", companyId)
        .maybeSingle(),
      admin
        .from("pf_settings")
        .select("*")
        .eq("company_id", companyId)
        .maybeSingle(),
      admin
        .from("attendance_settings")
        .select("*")
        .eq("company_id", companyId)
        .maybeSingle(),
      admin
        .from("pt_settings")
        .select("*")
        .eq("company_id", companyId)
        .maybeSingle(),
    ]);
    res.json({
      payroll: payroll ?? { currency: "INR", default_tax_regime: "NEW" },
      pf: pf ?? {},
      attendance: attendance ?? {},
      pt: pt ?? { enabled: false, state: null, slabs: [] },
    });
  } catch (e) {
    res.status(400).json({ error: "Unable to load payroll settings" });
  }
});
router.put("/payroll", async (req: AuthRequest, res) => {
  const body = payrollSchema.safeParse(req.body);
  if (!body.success)
    return res.status(400).json({
      error: "Invalid payroll settings",
      details: body.error.flatten().fieldErrors,
    });
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await payrollSettingsContext(req, companyId);
    if (!m)
      return res
        .status(403)
        .json({ error: "Payroll settings require company membership" });
    const pf = {
      company_id: companyId,
      enabled: body.data.pf_enabled,
      minimum_basic: body.data.minimum_basic,
      basic_percentage: body.data.basic_percentage,
      employee_pf_rate: body.data.employee_pf_rate,
      employer_pf_rate: body.data.employer_pf_rate,
      pf_wage_ceiling: body.data.pf_wage_ceiling,
    };
    const payroll = {
      company_id: companyId,
      currency: body.data.currency,
      default_tax_regime: body.data.default_tax_regime,
    };
    const attendance = {
      company_id: companyId,
      proration_basis: body.data.proration_basis,
    };
    const pt = {
      company_id: companyId,
      enabled: body.data.pt_enabled,
      state: body.data.pt_state,
      slabs: body.data.pt_slabs,
    };
    const results = await Promise.all([
      admin
        .from("payroll_settings")
        .upsert(payroll, { onConflict: "company_id" }),
      admin.from("pf_settings").upsert(pf, { onConflict: "company_id" }),
      admin
        .from("attendance_settings")
        .upsert(attendance, { onConflict: "company_id" }),
      admin.from("pt_settings").upsert(pt, { onConflict: "company_id" }),
    ]);
    const failed = results.find((r) => r.error);
    if (failed?.error) throw failed.error;
    await writeAudit(
      companyId,
      req.userId!,
      "SETTINGS_UPDATED",
      "PAYROLL",
      companyId,
      {
        fields: [
          "minimum_basic",
          "basic_percentage",
          "pf_enabled",
          "employee_pf_rate",
          "employer_pf_rate",
          "pf_wage_ceiling",
          "proration_basis",
          "pt_settings",
          "default_tax_regime",
        ],
      },
    );
    res.json({
      message: "Company payroll settings saved for future calculations",
    });
  } catch (e) {
    res.status(400).json({ error: "Unable to save payroll settings" });
  }
});

router.get("/statutory", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await context(req, companyId);
    if (!m) return res.status(403).json({ error: "Company access denied" });
    const [{ data: pf }, { data: pt }, { data: tds }, { data: rules }] =
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
        admin
          .from("tax_settings")
          .select("*")
          .eq("company_id", companyId)
          .order("financial_year", { ascending: false }),
        admin
          .from("statutory_rules")
          .select("*")
          .eq("company_id", companyId)
          .order("effective_from", { ascending: false }),
      ]);
    res.json({
      pf: pf ?? {},
      pt: pt ?? {},
      tds: tds ?? [],
      rules: rules ?? [],
    });
  } catch (e) {
    res.status(400).json({ error: "Unable to load statutory settings" });
  }
});
router.put("/statutory/rule", async (req: AuthRequest, res) => {
  const body = statutoryRuleSchema.safeParse(req.body);
  if (!body.success)
    return res.status(400).json({
      error: "Invalid statutory rule",
      details: body.error.flatten().fieldErrors,
    });
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await adminContext(req, companyId);
    if (!m)
      return res
        .status(403)
        .json({ error: "Statutory settings require administrator permission" });
    const payload = {
      company_id: companyId,
      statutory_type: body.data.statutory_type,
      effective_from: body.data.effective_from,
      effective_to: body.data.effective_to ?? null,
      config: body.data.config,
    };
    const result = body.data.id
      ? await admin
          .from("statutory_rules")
          .update(payload)
          .eq("company_id", companyId)
          .eq("id", body.data.id)
          .select("*")
          .single()
      : await admin
          .from("statutory_rules")
          .insert(payload)
          .select("*")
          .single();
    if (result.error) throw result.error;
    await writeAudit(
      companyId,
      req.userId!,
      "SETTINGS_UPDATED",
      "STATUTORY",
      body.data.id ?? null,
      {
        statutory_type: body.data.statutory_type,
        effective_from: body.data.effective_from,
      },
    );
    res.json({ rule: result.data });
  } catch (e) {
    res.status(400).json({ error: "Unable to save statutory rule" });
  }
});

router.get("/users", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await adminContext(req, companyId);
    if (!m)
      return res
        .status(403)
        .json({ error: "User management requires administrator permission" });
    const { data, error } = await admin
      .from("company_members")
      .select(
        "company_id,user_id,email,role,status,display_name,invited_at,last_login_at,deactivated_at,created_at",
      )
      .eq("company_id", companyId)
      .order("created_at");
    if (error) throw error;
    res.json({ users: data ?? [] });
  } catch (e) {
    res.status(400).json({ error: "Unable to load users" });
  }
});
router.post(
  "/users/invite",
  rateLimit({ max: 10, keyPrefix: "user-invite" }),
  async (req: AuthRequest, res) => {
    const body = inviteSchema.safeParse(req.body);
    if (!body.success)
      return res.status(400).json({
        error: "Invalid invitation details",
        details: body.error.flatten().fieldErrors,
      });
    try {
      const companyId = uuid.parse(String(req.query.company_id));
      const m = await adminContext(req, companyId);
      if (!m)
        return res
          .status(403)
          .json({ error: "User management requires administrator permission" });
      const { data: existing } = await admin
        .from("company_members")
        .select("user_id,status")
        .eq("company_id", companyId)
        .ilike("email", body.data.email)
        .maybeSingle();
      if (existing)
        return res
          .status(409)
          .json({ error: "That user is already associated with this company" });
      const { data: inv, error: ie } = await admin.auth.admin.inviteUserByEmail(
        body.data.email,
        { data: { display_name: body.data.name } },
      );
      if (ie || !inv.user) throw ie ?? new Error("Invitation failed");
      const { data: user, error } = await admin
        .from("company_members")
        .insert({
          company_id: companyId,
          user_id: inv.user.id,
          email: body.data.email.toLowerCase(),
          role: body.data.role,
          status: "INVITED",
          display_name: body.data.name,
          invited_at: new Date().toISOString(),
        })
        .select("company_id,user_id,email,role,status,display_name,invited_at")
        .single();
      if (error) throw error;
      await writeAudit(
        companyId,
        req.userId!,
        "USER_INVITED",
        "USER",
        inv.user.id,
        { role: body.data.role },
      );
      res.status(201).json({ user, invitation_sent: true });
    } catch (e) {
      res.status(400).json({
        error:
          "Unable to send invitation. Verify Supabase email/invitation configuration.",
      });
    }
  },
);
router.patch(
  "/users/:userId",
  rateLimit({ max: 30, keyPrefix: "user-update" }),
  async (req: AuthRequest, res) => {
    const body = updateMemberSchema.safeParse(req.body);
    if (!body.success)
      return res.status(400).json({ error: "Invalid user update" });
    try {
      const companyId = uuid.parse(String(req.query.company_id));
      const targetId = uuid.parse(req.params.userId);
      const m = await adminContext(req, companyId);
      if (!m)
        return res
          .status(403)
          .json({ error: "User management requires administrator permission" });
      if (
        targetId === req.userId &&
        body.data.status &&
        body.data.status !== "ACTIVE"
      )
        return res
          .status(400)
          .json({ error: "You cannot deactivate your own account" });
      const { data: target } = await admin
        .from("company_members")
        .select("role,status")
        .eq("company_id", companyId)
        .eq("user_id", targetId)
        .maybeSingle();
      if (!target) return res.status(404).json({ error: "User not found" });
      if (
        target.role === "OWNER" &&
        body.data.role &&
        body.data.role !== "OWNER"
      )
        return res
          .status(400)
          .json({ error: "The company owner role cannot be changed here" });
      const update: any = { ...body.data };
      if (body.data.status === "DEACTIVATED")
        update.deactivated_at = new Date().toISOString();
      if (body.data.status === "ACTIVE") update.deactivated_at = null;
      const { data: user, error } = await admin
        .from("company_members")
        .update(update)
        .eq("company_id", companyId)
        .eq("user_id", targetId)
        .select(
          "company_id,user_id,email,role,status,display_name,invited_at,last_login_at,deactivated_at,created_at",
        )
        .single();
      if (error) throw error;
      await writeAudit(
        companyId,
        req.userId!,
        "USER_UPDATED",
        "USER",
        targetId,
        {
          changed_fields: Object.keys(body.data),
          new_role: body.data.role ?? target.role,
          new_status: body.data.status ?? target.status,
        },
      );
      res.json({ user });
    } catch (e) {
      res.status(400).json({ error: "Unable to update user" });
    }
  },
);

router.get("/roles", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await context(req, companyId);
    if (!m) return res.status(403).json({ error: "Company access denied" });
    res.json({ current_role: m.role, roles: permissionMatrix() });
  } catch (e) {
    res.status(400).json({ error: "Unable to load roles and permissions" });
  }
});
router.get("/subscription", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await context(req, companyId);
    if (!m) return res.status(403).json({ error: "Company access denied" });
    const [{ data: subscription }, { data: plans }] = await Promise.all([
      admin
        .from("subscriptions")
        .select("*,plans(*)")
        .eq("company_id", companyId)
        .maybeSingle(),
      admin.from("plans").select("*").order("created_at"),
    ]);
    res.json({ subscription, plans: plans ?? [] });
  } catch (e) {
    res.status(400).json({ error: "Unable to load subscription" });
  }
});
router.put("/subscription", async (req: AuthRequest, res) => {
  const schema = z
    .object({
      plan_id: uuid,
      status: z
        .enum(["TRIAL", "ACTIVE", "PAST_DUE", "CANCELLED", "EXPIRED"])
        .optional(),
      trial_end: z.string().date().nullable().optional(),
    })
    .strict();
  const body = schema.safeParse(req.body);
  if (!body.success)
    return res.status(400).json({ error: "Invalid subscription settings" });
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await adminContext(req, companyId);
    if (!m)
      return res.status(403).json({
        error: "Subscription settings require administrator permission",
      });
    const payload = {
      company_id: companyId,
      plan_id: body.data.plan_id,
      status: body.data.status ?? "TRIAL",
      trial_end: body.data.trial_end ?? null,
      start_date: new Date().toISOString().slice(0, 10),
    };
    const { data, error } = await admin
      .from("subscriptions")
      .upsert(payload, { onConflict: "company_id" })
      .select("*,plans(*)")
      .single();
    if (error) throw error;
    await writeAudit(
      companyId,
      req.userId!,
      "SUBSCRIPTION_UPDATED",
      "SUBSCRIPTION",
      data.id,
      { plan_id: body.data.plan_id, status: payload.status },
    );
    res.json({ subscription: data });
  } catch (e) {
    res.status(400).json({ error: "Unable to save subscription" });
  }
});

router.get("/usage", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await context(req, companyId);
    if (!m) return res.status(403).json({ error: "Company access denied" });
    const [
      { count: employees },
      { count: users },
      { count: runs },
      { count: payslips },
      { data: docs },
      { data: planSub },
    ] = await Promise.all([
      admin
        .from("employees")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId),
      admin
        .from("company_members")
        .select("user_id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .in("status", ["ACTIVE", "INVITED"]),
      admin
        .from("payroll_runs")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId),
      admin
        .from("payslips")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId),
      admin
        .from("employee_documents")
        .select("file_size")
        .eq("company_id", companyId),
      admin
        .from("subscriptions")
        .select("*,plans(*)")
        .eq("company_id", companyId)
        .maybeSingle(),
    ]);
    const storageBytes = (docs ?? []).reduce(
      (sum: any, d: any) => sum + Number(d.file_size || 0),
      0,
    );
    const usage = {
      employees: employees ?? 0,
      users: users ?? 0,
      payroll_runs: runs ?? 0,
      payslips: payslips ?? 0,
      storage_bytes: storageBytes,
    };
    const { data: snapshot } = await admin
      .from("usage_metrics")
      .upsert(
        {
          company_id: companyId,
          metric_date: new Date().toISOString().slice(0, 10),
          employees_count: usage.employees,
          users_count: usage.users,
          payroll_runs_count: usage.payroll_runs,
          payslips_count: usage.payslips,
          storage_bytes: storageBytes,
        },
        { onConflict: "company_id,metric_date" },
      )
      .select("*")
      .single();
    res.json({ usage, snapshot, subscription: planSub });
  } catch (e) {
    res.status(400).json({ error: "Unable to load usage" });
  }
});

router.get("/security", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await context(req, companyId);
    if (!m) return res.status(403).json({ error: "Company access denied" });
    const { data: user } = await admin.auth.admin.getUserById(req.userId!);
    res.json({
      current_user: {
        id: req.userId,
        email: user.user?.email ?? null,
        last_sign_in_at: user.user?.last_sign_in_at ?? null,
      },
      session_policy: { supabase_auth: true, sign_out_all_sessions: true },
    });
  } catch (e) {
    res.status(400).json({ error: "Unable to load security settings" });
  }
});
router.get("/system-health", async (req: AuthRequest, res) => {
  try {
    const companyId = uuid.parse(String(req.query.company_id));
    const m = await adminContext(req, companyId);
    if (!m)
      return res
        .status(403)
        .json({ error: "System health requires administrator permission" });
    const db = await admin.from("companies").select("id").limit(1);
    const storage = await admin.storage
      .from("company-branding")
      .list(companyId, { limit: 1 });
    res.json({
      version: process.env.APP_VERSION || "1.8.0",
      checks: {
        application: { status: "HEALTHY" },
        database: { status: db.error ? "ERROR" : "HEALTHY" },
        storage: { status: storage.error ? "ERROR" : "HEALTHY" },
        authentication: {
          status:
            process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
              ? "HEALTHY"
              : "ERROR",
        },
      },
    });
  } catch (e) {
    res.status(400).json({ error: "Unable to load system health" });
  }
});

export default router;
