import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(process.cwd());
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
test("Phase 2 migration is additive and tenant-scoped", () => {
  const s = read("supabase/migrations/202609300002_phase2_employees.sql");
  for (const t of [
    "employees",
    "employee_employment_details",
    "employee_salary_assignments",
    "employee_bank_details",
    "employee_statutory_details",
    "employee_previous_employment",
    "employee_documents",
    "departments",
  ])
    assert.match(s, new RegExp(`create table public\\.${t}`));
  assert.match(s, /unique\(company_id,employee_id\)/);
  assert.match(s, /enable row level security/);
  assert.match(s, /public\.company_members/);
});
test("Employee API requires auth and company membership", () => {
  const s = read("apps/api/src/routes/employees.ts");
  assert.match(s, /router\.use\(requireAuth\)/);
  assert.match(s, /getMembership\(req\.userId!,companyId\)/);
  assert.match(s, /canEdit\(m\.role\)/);
  assert.match(s, /company_id/);
});
test("Employee summary separates on-notice and former employees", () => {
  const api = read("apps/api/src/routes/employees.ts");
  const page = read("apps/web/src/pages/Employees.tsx");
  assert.match(api, /\.eq\("employment_status", "ON_NOTICE"\)/);
  assert.match(api, /\.in\("employment_status", \["TERMINATED", "INACTIVE"\]\)/);
  assert.match(api, /onNotice: onNotice \?\? 0/);
  assert.match(api, /separated: separated \?\? 0/);
  assert.match(page, /<span>On notice<\/span>/);
  assert.match(page, /<span>Resigned \/ terminated<\/span>/);
});
test("Sensitive documents use private storage and signed URLs", () => {
  const s = read("apps/api/src/routes/employees.ts");
  const m = read("supabase/migrations/202609300002_phase2_employees.sql");
  assert.match(s, /createSignedUrl/);
  assert.match(s, /SUPABASE_EMPLOYEE_BUCKET/);
  assert.match(m, /public=false/);
  assert.match(s, /fileSize:5\*1024\*1024/);
});
test("ACCOUNTANT cannot access sensitive document downloads", () => {
  const s = read("apps/api/src/routes/employees.ts");
  assert.match(s, /!m\|\|!canViewSensitive\(m\.role\)/);
  const a = read("apps/api/src/lib/authorization.ts");
  assert.match(a, /canViewSensitive/);
});
test("Phase 2 frontend exposes employee management and preserves auth/onboarding", () => {
  const app = read("apps/web/src/App.tsx"),
    layout = read("apps/web/src/components/Layout.tsx"),
    page = read("apps/web/src/pages/Employees.tsx");
  assert.match(app, /path="\/employees"/);
  assert.match(layout, /path: '\/employees'.*enabled: true/);
  for (const x of [
    "Personal Details",
    "Employment",
    "Salary",
    "Bank & Statutory",
    "Previous Employer",
    "Documents",
  ])
    assert.match(page, new RegExp(x));
});
test("employee salary data remains employee-specific but calculation rules are company-wide", () => {
  const page = read("apps/web/src/pages/Employees.tsx"),
    api = read("apps/api/src/routes/employees.ts");
  assert.match(page, /annual_ctc/);
  assert.match(page, /previous_employer_taxable_salary/);
  for (const field of [
    "pf_applicable",
    "pt_applicable",
    "tds_applicable",
    "salary_structure_assignment",
  ])
    assert.doesNotMatch(page, new RegExp(field));
  assert.doesNotMatch(
    api,
    /pf_applicable:body\.pf_applicable|pt_applicable:body\.pt_applicable|tds_applicable:body\.tds_applicable/,
  );
});
