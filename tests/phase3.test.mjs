import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  calculateSalaryStructure,
  roundPayrollAmount,
} from "../packages/shared/src/payroll.ts";
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
  state: null,
  slabs: [
    { min: 0, max: 15000, amount: 0 },
    { min: 15000.01, max: 20000, amount: 150 },
    { min: 20000.01, max: null, amount: 200 },
  ],
};
const expected = [
  [150000, 11161, 1339, 0],
  [240000, 17857, 2143, 0],
  [270000, 20000, 2400, 100],
  [320000, 20000, 2400, 4267],
  [480000, 20000, 2400, 17600],
  [600000, 25000, 3000, 22000],
];
for (const [ctc, basic, employerPf, special] of expected) {
  test(`salary calculation ${ctc}`, () => {
    const r = calculateSalaryStructure({
      annualCtc: ctc,
      pfSettings: pf,
      ptSettings: pt,
    });
    assert.equal(r.annualCtc, ctc);
    assert.equal(r.basicSalary, basic);
    assert.equal(r.employerPf, employerPf);
    assert.equal(r.specialAllowance, special);
    assert.equal(r.monthlyCtc, roundPayrollAmount(ctc / 12));
  });
}
test("zero and negative CTC are rejected", () => {
  assert.throws(() =>
    calculateSalaryStructure({ annualCtc: 0, pfSettings: pf, ptSettings: pt }),
  );
  assert.throws(() =>
    calculateSalaryStructure({ annualCtc: -1, pfSettings: pf, ptSettings: pt }),
  );
});
test("PF ceiling and rounding are applied centrally", () => {
  const r = calculateSalaryStructure({
    annualCtc: 1200000,
    pfSettings: pf,
    ptSettings: pt,
  });
  assert.equal(r.basicSalary, 50000);
  assert.equal(r.employeePf, 3000);
  assert.equal(r.employerPf, 3000);
  assert.equal(roundPayrollAmount(123.51), 124);
});
test("Excel salary structure at 1,320,000 CTC", () => {
  const r = calculateSalaryStructure({
    annualCtc: 1320000,
    pfSettings: pf,
    ptSettings: pt,
  });
  assert.equal(r.monthlyCtc, 110000);
  assert.equal(r.basicSalary, 55000);
  assert.equal(r.specialAllowance, 52000);
  assert.equal(r.grossSalary, 107000);
  assert.equal(r.employeePf, 3000);
  assert.equal(r.employerPf, 3000);
  assert.equal(r.professionalTax, 200);
  assert.equal(r.estimatedNetSalary, 103800);
  assert.equal(r.totalEmployerCost, 110000);
});
test("special allowance never becomes negative", () => {
  const r = calculateSalaryStructure({
    annualCtc: 1,
    pfSettings: pf,
    ptSettings: pt,
  });
  assert.equal(r.specialAllowance, 0);
});
test("salary migration is additive and tenant isolated", () => {
  const s = read("supabase/migrations/202609300003_phase3_salary.sql");
  for (const t of [
    "payroll_settings",
    "pf_settings",
    "pt_settings",
    "salary_structures",
  ])
    assert.match(s, new RegExp(`create table public\\.${t}`));
  assert.match(s, /salary_structures_company_idx/);
  assert.match(s, /company_id uuid not null references public\.companies/);
  assert.match(s, /enable row level security/);
  assert.match(s, /public\.company_members/);
});
test("salary API has protected CRUD, revision and history endpoints without duplicate settings routes", () => {
  const s = read("apps/api/src/routes/salaryStructures.ts");
  for (const x of [
    "router.use(requireAuth)",
    "router.get('/employee/:employeeId/history'",
    "router.post('/revision'",
    "router.post('/'",
    "router.put('/:id'",
  ])
    assert.match(s, new RegExp(x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(s, /getMembership\(req\.userId!,companyId\)/);
  assert.match(s, /canEdit\(m\.role\)/);
  assert.doesNotMatch(s, /router\.(get|put)\(['"]\/settings/);
});
test("central payroll settings endpoint owns company PF, PT and Basic configuration", () => {
  const s = read("apps/api/src/routes/settings.ts");
  assert.match(s, /router\.get\(['"]\/payroll/);
  assert.match(s, /router\.put\(['"]\/payroll/);
  for (const setting of [
    "minimum_basic",
    "basic_percentage",
    "employee_pf_rate",
    "employer_pf_rate",
    "pf_wage_ceiling",
    "pt_enabled",
    "pt_state",
    "pt_slabs",
    "default_tax_regime",
  ])
    assert.match(s, new RegExp(setting));
});
test("company payroll settings are scoped to the selected company and member writes", () => {
  const s = read("apps/api/src/routes/settings.ts");
  assert.match(s, /adminContext\(\s*req\s*,\s*companyId\s*\)/);
  assert.match(s, /payrollSettingsContext\(req, companyId\)/);
  assert.match(
    s,
    /async function payrollSettingsContext\(req: AuthRequest, companyId: string\) \{\s*return context\(req, companyId\);\s*\}/,
  );
  assert.match(s, /\.eq\(\s*["']company_id["']\s*,\s*companyId\s*\)/);
  assert.match(s, /router\.get\(\s*["']\/payroll["']/);
  assert.match(s, /router\.put\(\s*["']\/payroll["']/);
});
test("salary frontend uses centralized pure calculator and whole-rupee formatting", () => {
  const s = read("apps/web/src/pages/SalaryStructure.tsx");
  assert.match(s, /calculateSalaryStructure/);
  assert.match(s, /toLocaleString\(["']en-IN["']\)/);
  assert.match(
    read("apps/web/src/modules/payroll/calculations/rounding.ts"),
    /roundPayrollAmount/,
  );
});
test("Phase 1 and Phase 2 routes remain present", () => {
  const app = read("apps/web/src/App.tsx");
  assert.match(app, /path="\/employees"/);
  assert.match(app, /path="\/settings"/);
  assert.match(app, /path="\/dashboard"/);
  assert.match(app, /path="\/employees\/salary-structures"/);
  assert.match(
    app,
    /path="\/salary-structure" element=\{<Navigate to="\/employees\/salary-structures"/,
  );
});
test("salary revision preserves history", () => {
  const s = read("apps/api/src/routes/salaryStructures.ts");
  assert.match(s, /status:'CLOSED'/);
  assert.match(s, /effective_to:new Date/);
  assert.match(s, /No active salary structure exists/);
});
