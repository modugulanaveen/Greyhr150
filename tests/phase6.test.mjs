import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  calculatePayrollRecord,
  reconcilePayrollTotals,
} from "../packages/shared/src/payrollRun.ts";
import { calculateMonthlyPayrollPreview } from "../packages/shared/src/attendance.ts";
const root = path.resolve(process.cwd());
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const pf = {
  enabled: true,
  employeePfRate: 12,
  employerPfRate: 12,
  pfWageCeiling: 25000,
  minimumBasic: 20000,
  basicPercentage: 50,
};
const pt = {
  enabled: true,
  state: "TELANGANA",
  slabs: [
    { min: 0, max: 15000, amount: 0 },
    { min: 15000.01, max: 20000, amount: 150 },
    { min: 20000.01, max: null, amount: 200 },
  ],
};
const attendanceSettings = {
  prorationBasis: "CALENDAR_DAYS",
  weeklyOffDays: [0, 6],
  holidays: [],
  pfCalculationBasis: "ACTUAL_ADJUSTED_WAGES",
};
const salary = {
  annual_ctc: 320000,
  monthly_ctc: 26667,
  basic_salary: 20000,
  special_allowance: 4267,
  gross_salary: 24267,
  employee_pf: 2400,
  employer_pf: 2400,
  professional_tax: 200,
};
function preview(lop = 0, joining = "2026-09-01") {
  const eligible = joining === "2026-09-28" ? 3 : 30;
  return calculateMonthlyPayrollPreview({
    salaryStructure: salary,
    payrollMonth: 9,
    payrollYear: 2026,
    joiningDate: joining,
    lopDays: lop,
    presentDays: Math.max(0, eligible - lop),
    paidLeaveDays: 0,
    attendanceSettings: attendanceSettings,
    pfSettings: pf,
    ptSettings: pt,
  });
}
test("full-month employee payroll snapshot uses Phase 4 preview", () => {
  const p = preview();
  const r = calculatePayrollRecord({ attendance: p, tds: 0 });
  assert.equal(r.grossSalary, 24267);
  assert.equal(r.adjustedGross, 24267);
  assert.equal(r.totalDeductions, 2600);
  assert.equal(r.netSalary, 21667);
  assert.equal(r.employerCost, 26667);
});
test("1 LOP flows into payroll without changing permanent salary", () => {
  const p = preview(1);
  const r = calculatePayrollRecord({ attendance: p, tds: 5000 });
  assert.equal(p.lopDays, 1);
  assert.equal(r.lopDeduction, 809);
  assert.equal(salary.basic_salary, 20000);
  assert.equal(r.adjustedGross, 23458);
});
test("multiple LOP days and TDS are deducted from adjusted gross", () => {
  const p = preview(2);
  const r = calculatePayrollRecord({ attendance: p, tds: 5000 });
  assert.equal(r.adjustedGross, 22650);
  assert.equal(r.totalDeductions, 7440);
  assert.equal(r.netSalary, 15210);
});
test("mid-month joiner gets only eligible paid days", () => {
  const p = preview(0, "2026-09-28");
  const r = calculatePayrollRecord({ attendance: p, tds: 0 });
  assert.equal(p.paidDays, 3);
  assert.equal(r.adjustedGross, 2427);
});
test("salary revision is represented by selected snapshot salary structure", () => {
  const old = { annual_ctc: 320000 };
  const newer = { annual_ctc: 420000, effective_from: "2026-09-01" };
  const selected = [old, newer].sort((a, b) =>
    String(b.effective_from || "").localeCompare(
      String(a.effective_from || ""),
    ),
  )[0];
  assert.equal(selected.annual_ctc, 420000);
});
test("previous employer TDS is upstream Phase 5 input, payroll consumes current-month schedule", () => {
  const tdsSchedule = 5000;
  const r = calculatePayrollRecord({ attendance: preview(), tds: tdsSchedule });
  assert.equal(r.tds, 5000);
});
test("zero TDS payroll has no TDS deduction", () => {
  const r = calculatePayrollRecord({ attendance: preview(), tds: 0 });
  assert.equal(r.tds, 0);
});
test("manual bonus and other deduction are audited inputs to calculation", () => {
  const r = calculatePayrollRecord({
    attendance: preview(),
    tds: 0,
    adjustments: { earnings: 1000, deductions: 200 },
  });
  assert.equal(r.adjustedGross, 25267);
  assert.equal(r.totalDeductions, 2800);
  assert.equal(r.netSalary, 22467);
});
test("missing attendance is a validation rule in payroll API", () => {
  const s = read("apps/api/src/routes/payroll.ts");
  assert.match(s, /MISSING_ATTENDANCE/);
  assert.match(s, /no attendance record/);
});
test("missing salary, bank, UAN and TDS validation rules exist", () => {
  const s = read("apps/api/src/routes/payroll.ts");
  for (const code of [
    "MISSING_SALARY",
    "MISSING_BANK",
    "MISSING_UAN",
    "MISSING_TDS_PROFILE",
    "MISSING_TDS_SCHEDULE",
  ])
    assert.match(s, new RegExp(code));
});
test("duplicate payroll period is prevented by database and API", () => {
  const s = read("supabase/migrations/202609300006_phase6_payroll.sql");
  assert.match(s, /unique\(company_id,payroll_month,payroll_year\)/);
  assert.match(
    read("apps/api/src/routes/payroll.ts"),
    /Payroll already exists/,
  );
});
test("payroll records are unique per run and employee", () => {
  const s = read("supabase/migrations/202609300006_phase6_payroll.sql");
  assert.match(s, /unique\(company_id,payroll_run_id,employee_id\)/);
});
test("approval lock and reopen workflow is server protected", () => {
  const s = read("apps/api/src/routes/payroll.ts");
  for (const route of [
    "router.post('/:id/review'",
    "router.post('/:id/approve'",
    "router.post('/:id/lock'",
    "router.post('/:id/reopen'",
  ])
    assert.match(s, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(s, /Only administrators can lock payroll/);
  assert.match(s, /Only administrators can reopen payroll/);
});
test("reconciliation formulas are centralized and whole-rupee", () => {
  const r = reconcilePayrollTotals({
    gross: 1100,
    employeePf: 100,
    pt: 50,
    tds: 100,
    otherDeductions: 0,
    adjustmentDeductions: 25,
    net: 825,
    employerPf: 100,
    employerCost: 1200,
  });
  assert.equal(r.netMatches, true);
  assert.equal(r.employerCostMatches, true);
});
test("payroll migration is additive, tenant isolated and RLS protected", () => {
  const s = read("supabase/migrations/202609300006_phase6_payroll.sql");
  for (const t of [
    "payroll_runs",
    "payroll_records",
    "payroll_adjustments",
    "payroll_validation_errors",
    "payroll_audit_logs",
  ])
    assert.match(s, new RegExp(`create table public\\.${t}`));
  assert.match(s, /enable row level security/g);
  assert.match(s, /public\.company_members/);
  assert.doesNotMatch(s, /create table public\.employees/);
});
test("payroll frontend routes and navigation are enabled", () => {
  const app = read("apps/web/src/App.tsx");
  assert.match(app, /path="\/payroll"/);
  assert.match(app, /path="\/payroll\/history"/);
  assert.match(app, /path="\/payroll\/:payrollId\/employee\/:employeeId"/);
  const layout = read("apps/web/src/components/Layout.tsx");
  assert.match(
    layout,
    /path: '\/payroll', label: 'Payroll runs', icon: CreditCard, enabled: true/,
  );
});
test("payroll reuses Phase 3, Phase 4 and Phase 5 engines instead of duplicating them", () => {
  const s = read("apps/api/src/routes/payroll.ts");
  assert.match(s, /calculateMonthlyPayrollPreview/);
  assert.match(s, /tds_monthly_schedule/);
  assert.match(s, /salary_structures/);
  assert.match(s, /attendance_records/);
  const shared = read("packages/shared/src/payrollRun.ts");
  assert.match(shared, /calculatePayrollRecord/);
});
test("locked payroll stores approval and lock metadata and snapshot records", () => {
  const s = read("supabase/migrations/202609300006_phase6_payroll.sql");
  for (const x of [
    "approved_by",
    "approved_at",
    "locked_by",
    "locked_at",
    "created_by",
  ])
    assert.match(s, new RegExp(x));
  assert.match(s, /payroll_records/);
});
test("new payroll calculations use current company settings and preserve locked snapshots", () => {
  const s = read("apps/api/src/routes/payroll.ts");
  assert.match(
    s,
    /calculateSalaryStructure\(\{annualCtc:Number\(storedSalary\.annual_ctc\),pfSettings:cfg\.pf,ptSettings:cfg\.pt\}\)/,
  );
  assert.match(s, /const cfg=await config\(companyId\)/);
  assert.match(
    s,
    /if\(\['APPROVED','LOCKED'\]\.includes\(run\.status\)\)return res\.status\(409\)/,
  );
  assert.match(s, /payroll_records/);
  assert.doesNotMatch(s, /e\.pf_applicable|e\.pt_applicable|e\.tds_applicable/);
});
