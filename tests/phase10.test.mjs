import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(p, "utf8");

test("Phase 10 migration is additive and creates SaaS structures", () => {
  const sql = read(
    `${root}supabase/migrations/202609300010_phase10_production.sql`,
  );
  assert.match(sql, /add column if not exists trade_name/);
  assert.match(sql, /create table if not exists public\.plans/);
  assert.match(sql, /create table if not exists public\.subscriptions/);
  assert.match(sql, /create table if not exists public\.usage_metrics/);
  assert.match(sql, /create policy "admins manage subscription"/);
});

test("Sensitive storage remains private", () => {
  const sql = read(
    `${root}supabase/migrations/202609300010_phase10_production.sql`,
  );
  assert.match(sql, /company-branding','company-branding',false/);
  for (const phaseFile of [
    "202609300002_phase2_employees.sql",
    "202609300007_phase7_payslips.sql",
    "202609300008_phase8_compliance.sql",
  ]) {
    const phase = read(`${root}supabase/migrations/${phaseFile}`);
    assert.doesNotMatch(
      phase,
      /values\s*\([^\n]*'(employee-documents|payslips|payslip-branding|compliance)'[^\n]*true/i,
    );
  }
});

test("Audit history is protected against update/delete", () => {
  const sql = read(
    `${root}supabase/migrations/202609300010_phase10_production.sql`,
  );
  assert.match(
    sql,
    /create or replace function public\.prevent_audit_mutation/,
  );
  assert.match(sql, /audit_logs_immutable before update or delete/);
  assert.match(sql, /payroll_audit_logs_immutable before update or delete/);
  assert.match(sql, /compliance_audit_logs_immutable before update or delete/);
});

test("API production controls are present", () => {
  const server = read(`${root}apps/api/src/server.ts`);
  assert.match(server, /helmet/);
  assert.match(server, /credentials: true/);
  assert.match(read(`${root}apps/api/src/lib/config.ts`), /MAX_JSON_BODY/);
  assert.match(server, /app\.get\('\/health'/);
  assert.doesNotMatch(server, /Access-Control-Allow-Origin:\s*\*/);
});

test("Sensitive operations have explicit rate limits", () => {
  for (const [file, patterns] of Object.entries({
    "apps/api/src/routes/compliance.ts": [
      "keyPrefix:'ecr'",
      "keyPrefix:'statutory-payment'",
    ],
    "apps/api/src/routes/reports.ts": ["keyPrefix:'report-export'"],
    "apps/api/src/routes/payslips.ts": [
      "keyPrefix:'payslip-bulk'",
      "keyPrefix:'payslip-generate'",
    ],
    "apps/api/src/routes/payroll.ts": [
      "keyPrefix:'payroll-calculate'",
      "keyPrefix:'payroll-lock'",
      "keyPrefix:'payroll-reopen'",
    ],
  })) {
    const source = read(`${root}${file}`);
    for (const pattern of patterns)
      assert.match(
        source,
        new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
  }
});

test("Locked payroll prevents attendance writes", () => {
  const source = read(`${root}apps/api/src/routes/attendance.ts`);
  assert.match(source, /assertPayrollPeriodOpen/);
  assert.match(source, /\[\s*["']APPROVED["']\s*,\s*["']LOCKED["']\s*\]/);
  assert.match(source, /Attendance cannot be modified/);
});

test("Deactivated memberships are denied by server authorization", () => {
  const source = read(`${root}apps/api/src/lib/authorization.ts`);
  assert.match(source, /DEACTIVATED.*SUSPENDED/);
  const migration = read(
    `${root}supabase/migrations/202609300010_phase10_production.sql`,
  );
  assert.match(migration, /status='ACTIVE'/);
});

test("Production artifacts contain no real secret values", () => {
  const examples = [
    read(`${root}apps/api/.env.example`),
    read(`${root}apps/web/.env.example`),
  ].join("\n");
  assert.match(examples, /YOUR_SUPABASE/);
  assert.doesNotMatch(
    examples,
    /service_role_key\s*=\s*(eyJ|sb_secret|sk_live)/i,
  );
});

test("Phase 10 documentation exists", () => {
  for (const p of [
    "PRODUCTION_CHECKLIST.md",
    "SECURITY_CHECKLIST.md",
    "docs/BACKUP_RECOVERY.md",
    "vercel.json",
  ])
    assert.equal(fs.existsSync(`${root}${p}`), true, p);
});
test("Audit viewer is removed while required audit stores remain", () => {
  const app = read(`${root}apps/web/src/App.tsx`);
  const settings = read(`${root}apps/web/src/pages/Settings.tsx`);
  const api = read(`${root}apps/api/src/routes/settings.ts`);
  assert.doesNotMatch(app, /AuditLogsSettings/);
  assert.match(
    app,
    /settings\/audit-logs" element=\{<Navigate to="\/settings"/,
  );
  assert.doesNotMatch(settings, /Audit Logs/);
  assert.doesNotMatch(api, /router\.get\(["']\/audit-logs/);
  assert.match(api, /writeAudit/);
  assert.match(
    read(`${root}supabase/migrations/202609300004_phase4_attendance.sql`),
    /create table public\.audit_logs/,
  );
  assert.match(
    read(`${root}supabase/migrations/202609300006_phase6_payroll.sql`),
    /create table public\.payroll_audit_logs/,
  );
});
