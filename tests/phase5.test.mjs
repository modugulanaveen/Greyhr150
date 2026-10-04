import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  calculateAnnualTax,
  calculateProgressiveTax,
  calculateMarginalRelief,
  calculateTdsSchedule,
  roundTaxAmount,
} from "../packages/shared/src/tax.ts";
const root = path.resolve(process.cwd());
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const newSettings = {
  financialYear: "2026-27",
  regime: "NEW",
  standardDeduction: 75000,
  cessRate: 4,
  slabs: [
    { lowerLimit: 0, upperLimit: 400000, rate: 0 },
    { lowerLimit: 400000, upperLimit: 800000, rate: 5 },
    { lowerLimit: 800000, upperLimit: 1200000, rate: 10 },
    { lowerLimit: 1200000, upperLimit: 1600000, rate: 15 },
    { lowerLimit: 1600000, upperLimit: 2000000, rate: 20 },
    { lowerLimit: 2000000, upperLimit: 2400000, rate: 25 },
    { lowerLimit: 2400000, upperLimit: null, rate: 30 },
  ],
  rebate: { incomeLimit: 1200000, maximumRebate: 60000 },
  marginalReliefEnabled: true,
  marginalReliefIncomeLimit: 1200000,
};
const base = {
  financialYear: "2026-27",
  taxRegime: "NEW",
  previousEmployerTaxableSalary: 0,
  previousEmployerTds: 0,
  currentEmployerProjectedTaxableSalary: 600000,
  otherTaxableIncome: 0,
  otherTds: 0,
  settings: newSettings,
};
test("below rebate threshold becomes zero where rebate fully offsets slab tax", () => {
  const r = calculateAnnualTax({
    ...base,
    currentEmployerProjectedTaxableSalary: 1200000,
  });
  assert.equal(r.taxableIncome, 1125000);
  assert.equal(r.rebate, r.taxBeforeRebate);
  assert.equal(r.annualTaxLiability, 0);
});
test("above rebate threshold calculates tax, rebate, relief and cess separately", () => {
  const r = calculateAnnualTax({
    ...base,
    currentEmployerProjectedTaxableSalary: 1300000,
  });
  assert.ok(r.taxBeforeRebate > 0);
  assert.equal(r.rebate, 0);
  assert.ok(r.marginalRelief >= 0);
  assert.ok(r.cess >= 0);
  assert.equal(r.annualTaxLiability, r.taxAfterRebate + r.cess);
});
test("previous employer taxable salary is not reduced by standard deduction again", () => {
  const r = calculateAnnualTax({
    ...base,
    previousEmployerTaxableSalary: 695500,
    currentEmployerProjectedTaxableSalary: 0,
  });
  assert.equal(r.totalIncome, 695500);
  assert.equal(r.standardDeduction, 0);
  assert.equal(r.taxableIncome, 695500);
});
test("standard deduction is applied once to current employer salary", () => {
  const r = calculateAnnualTax({
    ...base,
    previousEmployerTaxableSalary: 695500,
    currentEmployerProjectedTaxableSalary: 500000,
  });
  assert.equal(r.standardDeduction, 75000);
  assert.equal(r.taxableIncome, 1120500);
});
test("previous employer TDS reduces remaining annual TDS", () => {
  const r = calculateAnnualTax({
    ...base,
    previousEmployerTaxableSalary: 695500,
    previousEmployerTds: 50000,
    currentEmployerProjectedTaxableSalary: 1000000,
  });
  assert.equal(r.remainingTds, Math.max(0, r.annualTaxLiability - 50000));
});
test("previous employer salary and TDS combine with current salary without a second deduction", () => {
  const r = calculateAnnualTax({
    ...base,
    previousEmployerTaxableSalary: 695500,
    previousEmployerTds: 50000,
    currentEmployerProjectedTaxableSalary: 500000,
  });
  assert.equal(r.totalIncome, 1195500);
  assert.equal(r.standardDeduction, 75000);
  assert.equal(r.taxableIncome, 1120500);
  assert.equal(r.remainingTds, Math.max(0, r.annualTaxLiability - 50000));
});
test("other taxable income is included before one standard deduction", () => {
  const r = calculateAnnualTax({
    ...base,
    currentEmployerProjectedTaxableSalary: 500000,
    otherTaxableIncome: 100000,
  });
  assert.equal(r.totalIncome, 600000);
  assert.equal(r.taxableIncome, 525000);
});
test("workbook May projection receives one standard deduction and rebate", () => {
  const r = calculateAnnualTax({
    ...base,
    currentEmployerProjectedTaxableSalary: 1083807,
  });
  assert.equal(r.taxableIncome, 1008807);
  assert.equal(r.annualTaxLiability, 0);
});
test("marginal relief caps tax at excess over rebate threshold", () => {
  const rebate = { incomeLimit: 1200000, maximumRebate: 60000 };
  assert.equal(calculateMarginalRelief(1210000, 20000, rebate, true), 10000);
});
test("progressive slabs are cumulative", () => {
  assert.equal(calculateProgressiveTax(800000, newSettings.slabs), 20000);
});
test("short first month prorates and redistributes deferred TDS", () => {
  const r = calculateTdsSchedule({
    annualTaxLiability: 100000,
    alreadyDeducted: 0,
    payrollMonths: 10,
    firstMonthPaidDays: 6,
    firstMonthDays: 30,
    method: "PRORATED_REDISTRIBUTE",
  });
  assert.equal(r.firstMonthTds, 2000);
  assert.equal(r.deferredTds, 8000);
  assert.equal(
    r.schedule.reduce((n, x) => n + x.tdsAmount, 0),
    100000,
  );
});
test("Excel example prorates 200,000 TDS and rounds the redistributed months", () => {
  const r = calculateTdsSchedule({
    annualTaxLiability: 200000,
    alreadyDeducted: 0,
    payrollMonths: 10,
    firstMonthPaidDays: 6,
    firstMonthDays: 30,
    firstMonthPaidDayFactor: 1,
    method: "PRORATED_REDISTRIBUTE",
  });
  assert.equal(r.normalMonthlyTds, 20000);
  assert.equal(r.firstMonthTds, 4000);
  assert.equal(r.deferredTds, 16000);
  assert.equal(r.remainingMonths, 9);
  assert.equal(r.schedule[1].tdsAmount, 21778);
  assert.equal(r.schedule.at(-1).tdsAmount, 21776);
  assert.equal(r.finalMonthAdjustment, -2);
  assert.equal(
    r.schedule.reduce((n, row) => n + row.tdsAmount, 0),
    200000,
  );
  assert.equal(r.schedule.at(-1).cumulativeTds, 200000);
});
test("first-month paid-day factor scales the workbook prorating formula", () => {
  const r = calculateTdsSchedule({
    annualTaxLiability: 200000,
    alreadyDeducted: 0,
    payrollMonths: 10,
    firstMonthPaidDays: 6,
    firstMonthDays: 30,
    firstMonthPaidDayFactor: 0.5,
    method: "PRORATED_REDISTRIBUTE",
  });
  assert.equal(r.firstMonthTds, 2000);
  assert.equal(r.deferredTds, 18000);
  assert.equal(
    r.schedule.reduce((n, row) => n + row.tdsAmount, 0),
    200000,
  );
});
test("full monthly method does not defer first month", () => {
  const r = calculateTdsSchedule({
    annualTaxLiability: 100000,
    alreadyDeducted: 0,
    payrollMonths: 10,
    firstMonthPaidDays: 6,
    firstMonthDays: 30,
    method: "FULL_MONTHLY",
  });
  assert.equal(r.firstMonthTds, 10000);
  assert.equal(r.deferredTds, 0);
  assert.equal(
    r.schedule.reduce((n, x) => n + x.tdsAmount, 0),
    100000,
  );
});
test("full paid first month is not reduced by prorating", () => {
  const r = calculateTdsSchedule({
    annualTaxLiability: 200000,
    alreadyDeducted: 0,
    payrollMonths: 10,
    firstMonthPaidDays: 30,
    firstMonthDays: 30,
    method: "PRORATED_REDISTRIBUTE",
  });
  assert.equal(r.firstMonthTds, 20000);
  assert.equal(r.deferredTds, 0);
});
test("current employer TDS already deducted reduces the remaining schedule", () => {
  const r = calculateTdsSchedule({
    annualTaxLiability: 200000,
    alreadyDeducted: 25000,
    payrollMonths: 9,
    firstMonthPaidDays: 30,
    firstMonthDays: 30,
    method: "FULL_MONTHLY",
  });
  assert.equal(r.annualTdsToRecover, 175000);
  assert.equal(
    r.schedule.reduce((n, row) => n + row.tdsAmount, 0),
    175000,
  );
});
test("final month receives whole-rupee reconciliation", () => {
  const r = calculateTdsSchedule({
    annualTaxLiability: 100001,
    alreadyDeducted: 0,
    payrollMonths: 9,
    firstMonthPaidDays: 30,
    firstMonthDays: 30,
    method: "FULL_MONTHLY",
  });
  assert.equal(
    r.schedule.reduce((n, x) => n + x.tdsAmount, 0),
    100001,
  );
  assert.equal(r.schedule.at(-1).remainingTds, 0);
});
test("zero annual tax produces zero schedule", () => {
  const r = calculateTdsSchedule({
    annualTaxLiability: 0,
    alreadyDeducted: 0,
    payrollMonths: 12,
    firstMonthPaidDays: 30,
    firstMonthDays: 30,
    method: "PRORATED_REDISTRIBUTE",
  });
  assert.equal(r.schedule.length, 0);
});
test("tax migration is additive, company scoped and RLS protected", () => {
  const s = read("supabase/migrations/202609300005_phase5_tax.sql");
  for (const t of [
    "tax_settings",
    "tax_slabs",
    "tax_rebates",
    "employee_tax_profiles",
    "tds_calculations",
    "tds_monthly_schedule",
  ])
    assert.match(s, new RegExp(`create table public\\.${t}`));
  assert.match(s, /unique\(company_id, employee_id, financial_year\)/);
  assert.match(s, /enable row level security/g);
  assert.match(s, /tax_employee_same_company/);
});
test("tax API protects settings, profiles, calculations and export", () => {
  const s = read("apps/api/src/routes/tds.ts");
  assert.match(s, /router\.use\(requireAuth\)/);
  for (const [method, route] of [
    ["get", "/settings"],
    ["put", "/settings"],
    ["put", "/settings/slabs"],
    ["get", "/profile/:employeeId"],
    ["put", "/profile"],
    ["post", "/calculate"],
    ["get", "/employee/:employeeId"],
    ["get", "/"],
    ["get", "/dashboard"],
    ["get", "/export"],
  ]) {
    assert.match(
      s,
      new RegExp(
        `router\\.${method}\\(\\s*["']${route.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}["']`,
      ),
    );
  }
  assert.match(s, /getMembership\(req\.userId!\s*,\s*companyId\)/);
  assert.match(s, /company_id/);
  assert.match(s, /getCompanyTaxRegime/);
});
test("TDS frontend route, tax settings and reusable modules exist", () => {
  const app = read("apps/web/src/App.tsx");
  assert.match(app, /path="\/tds"/);
  assert.match(app, /path="\/settings\/tax"/);
  assert.match(
    app,
    /path="\/tds" element=\{<Navigate to="\/settings\/payroll"/,
  );
  assert.match(
    app,
    /path="\/settings\/tax" element=\{<Navigate to="\/settings\/payroll"/,
  );
  assert.match(app, /path="\/settings\/payroll" element=\{<PayrollSettings/);
  assert.doesNotMatch(app, /import TDS from/);
  assert.doesNotMatch(app, /path="\/settings\/tax" element=\{<TaxSettings/);
  assert.doesNotMatch(app, /path="\/settings\/tds" element=\{<TaxSettings/);
  assert.match(
    read("apps/web/src/pages/PayrollSettings.tsx"),
    /<TaxSettings embedded/,
  );
  for (const f of [
    "apps/web/src/modules/tax/taxCalculator.ts",
    "apps/web/src/modules/tax/taxSlabCalculator.ts",
    "apps/web/src/modules/tax/rebateCalculator.ts",
    "apps/web/src/modules/tax/marginalReliefCalculator.ts",
    "apps/web/src/modules/tax/cessCalculator.ts",
    "apps/web/src/modules/tax/tdsAllocation.ts",
    "apps/web/src/modules/tax/taxRounding.ts",
    "apps/web/src/modules/tax/tdsProjection.ts",
  ])
    assert.equal(fs.existsSync(path.join(root, f)), true);
});
test("company default regime is stored additively on payroll settings", () => {
  const s = read("supabase/migrations/202609300012_company_tax_regime.sql");
  assert.match(s, /alter table public\.payroll_settings/);
  assert.match(
    s,
    /add column if not exists default_tax_regime text not null default 'NEW'/,
  );
  assert.match(s, /check \(default_tax_regime in \('NEW', 'OLD'\)\)/);
});
test("TDS does not introduce duplicate employee or attendance tables", () => {
  const s = read("supabase/migrations/202609300005_phase5_tax.sql");
  assert.doesNotMatch(s, /create table public\.employees/);
  assert.doesNotMatch(s, /create table public\.attendance_records/);
});
test("whole rupee tax rounding is centralized", () => {
  assert.equal(roundTaxAmount(123.49), 123);
  assert.equal(roundTaxAmount(123.5), 124);
});
test("Excel TDS factor migration defaults safely and permits signed rounding reconciliation", () => {
  const s = read("supabase/migrations/202609300011_tds_excel_parity.sql");
  assert.match(
    s,
    /add column first_month_tds_paid_day_factor numeric\(5,4\) not null default 1/i,
  );
  assert.match(
    s,
    /check\s*\(\s*first_month_tds_paid_day_factor between 0 and 1\s*\)/i,
  );
  assert.doesNotMatch(
    s,
    /drop\s+constraint[^;]*payroll_records_lop_deduction_check/i,
  );
  const payrollMigration = read(
    "supabase/migrations/202609300006_phase6_payroll.sql",
  );
  assert.match(
    payrollMigration,
    /lop_deduction numeric\(15,2\) not null default 0 check\(lop_deduction >= 0\)/,
  );
});
test("TDS API uses the factor and finalized payroll history", () => {
  const s = read("apps/api/src/routes/tds.ts");
  assert.ok(s.includes("first_month_tds_paid_day_factor"));
  assert.ok(s.includes("firstMonthPaidDays"));
  assert.ok(s.includes("getPriorCurrentEmployerTds"));
  assert.match(
    s,
    /\.in\(\s*["']status["']\s*,\s*\[\s*["']APPROVED["']\s*,\s*["']LOCKED["']\s*\]\s*\)/,
  );
  assert.match(s, /\.in\(\s*["']payroll_month["']\s*,\s*scheduleMonths\s*\)/);
});
test("first-month method is configurable and final reconciliation is explicit", () => {
  const s = read("supabase/migrations/202609300005_phase5_tax.sql");
  assert.match(s, /first_month_tds_method/);
  assert.match(s, /PRORATED_REDISTRIBUTE/);
  assert.match(s, /final_month_adjustment_enabled/);
});
test("tax projection reuses Phase 4 attendance and Phase 3 salary structures", () => {
  const s = read("apps/api/src/routes/tds.ts");
  assert.match(s, /calculateMonthlyPayrollPreview/);
  assert.match(s, /attendance_records/);
  assert.match(s, /salary_structures/);
  assert.match(s, /effective_from/);
});
