import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("Phase 9 migration is additive and adds targeted analytics indexes", () => {
  const s = read(
    "supabase/migrations/202609300009_phase9_analytics_indexes.sql",
  );
  assert.match(
    s,
    /create index if not exists payroll_runs_company_status_period_idx/,
  );
  assert.match(s, /payroll_records_company_run_employee_idx/);
  assert.match(s, /employees_company_join_exit_idx/);
  assert.match(s, /payslips_company_period_status_idx/);
});
test("reports API is authenticated and mounted", () => {
  const s = read("apps/api/src/routes/reports.ts");
  const server = read("apps/api/src/server.ts");
  assert.match(s, /router\.use\(requireAuth\)/);
  assert.match(s, /companyId=uuid\.parse/);
  assert.match(s, /getMembership/);
  assert.match(s, /canView/);
  assert.match(server, /app\.use\('\/api\/reports', reports\)/);
});
test("dashboard consumes payroll snapshots and Phase 8 liabilities", () => {
  const s = read("apps/api/src/routes/reports.ts");
  assert.match(s, /from\('payroll_runs'\)/);
  assert.match(s, /from\('payroll_records'\)/);
  assert.match(s, /from\('statutory_liabilities'\)/);
  assert.match(s, /from\('statutory_payments'\)/);
  assert.doesNotMatch(s, /calculateMonthlyPayrollPreview/);
});
test("payroll register exposes snapshot fields without recalculation", () => {
  const s = read("apps/api/src/routes/reports.ts");
  for (const field of [
    "basic_salary",
    "special_allowance",
    "gross_salary",
    "employee_pf",
    "professional_tax",
    "tds",
    "total_deductions",
    "net_salary",
    "employer_pf",
    "employer_cost",
  ])
    assert.match(s, new RegExp(field));
});
test("report exports use authenticated server endpoint and audit events", () => {
  const api = read("apps/api/src/routes/reports.ts");
  const client = read("apps/web/src/lib/api.ts");
  assert.match(api, /REPORT_GENERATED/);
  assert.match(api, /REPORT_EXPORTED/);
  assert.match(api, /XLSX\.write/);
  assert.match(client, /apiBlob/);
});
test("Phase 9 routes and navigation are enabled", () => {
  const app = read("apps/web/src/App.tsx");
  const nav = read("apps/web/src/components/Layout.tsx");
  assert.match(app, /path="\/reports"/);
  assert.match(app, /path="\/reports\/:type"/);
  assert.match(nav, /Reports & Analytics/);
});
test("dashboard has empty, refresh, loading/error and analytics sections", () => {
  const s = read("apps/web/src/pages/Dashboard.tsx");
  for (const text of [
    "No payroll has been processed yet.",
    "Refresh Data",
    "Payroll Trend",
    "Employee Headcount",
    "Department-wise Payroll",
    "Salary Distribution",
    "Attendance & LOP",
    "Statutory Compliance",
    "Quick Actions",
  ])
    assert.match(s, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
test("reports have reusable filters, table search/pagination/columns and Excel export", () => {
  const filters = read("apps/web/src/components/ReportFilters.tsx");
  const table = read("apps/web/src/components/ReportTable.tsx");
  assert.match(filters, /Financial Year/);
  assert.match(filters, /Department/);
  assert.match(filters, /Employee/);
  assert.match(table, /Search this page/);
  assert.match(table, /Columns/);
  assert.match(table, /onPageChange/);
  assert.match(table, /apiBlob/);
});
test("no secrets are included in Phase 9 files", () => {
  const files = [
    "apps/api/src/routes/reports.ts",
    "apps/web/src/pages/Dashboard.tsx",
    "apps/web/src/pages/Reports.tsx",
    "apps/web/src/pages/ReportPage.tsx",
  ];
  for (const f of files) {
    const s = read(f);
    assert.doesNotMatch(s, /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*['\"][^'\"]+/);
    assert.doesNotMatch(s, /-----BEGIN (RSA|EC|PRIVATE) KEY-----/);
  }
});
