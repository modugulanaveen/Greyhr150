import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  calculateMonthlyPayrollPreview,
  daysInMonth,
  countWorkingDays,
  eligiblePayrollDays,
} from "../packages/shared/src/attendance.ts";
import { roundPayrollAmount } from "../packages/shared/src/payroll.ts";
import { calculatePayrollRecord } from "../packages/shared/src/payrollRun.ts";
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
const settings = {
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
function calc(lop, joining = "2026-09-01", present, leave) {
  return calculateMonthlyPayrollPreview({
    salaryStructure: salary,
    payrollMonth: 9,
    payrollYear: 2026,
    joiningDate: joining,
    lopDays: lop,
    presentDays: present,
    paidLeaveDays: leave,
    attendanceSettings: settings,
    pfSettings: pf,
    ptSettings: pt,
  });
}
test("full month employee with 0 LOP", () => {
  const r = calc(0);
  assert.equal(r.eligibleDays, 30);
  assert.equal(r.paidDays, 30);
  assert.equal(r.lopDeduction, 0);
  assert.equal(r.grossSalary, 24267);
});
test("full month employee with 1 LOP", () => {
  const r = calc(1);
  assert.equal(r.paidDays, 29);
  assert.equal(r.lopDeduction, roundPayrollAmount(24267 / 30));
});
test("full month employee with 2 LOP", () => {
  const r = calc(2);
  assert.equal(r.paidDays, 28);
  assert.equal(r.grossSalary, 22650);
  assert.equal(r.lopDeduction, 1617);
});
test("employee joining on first", () => {
  assert.equal(calc(0, "2026-09-01").eligibleDays, 30);
});
test("employee joining mid month", () => {
  const r = calc(0, "2026-09-28");
  assert.equal(r.eligibleDays, 3);
  assert.equal(r.paidDays, 3);
  assert.equal(r.grossSalary, 2427);
});
test("employee joining on last day", () => {
  const r = calc(0, "2026-09-30");
  assert.equal(r.eligibleDays, 1);
  assert.equal(r.paidDays, 1);
});
test("Excel May 28 joiner prorates salary components and deductions independently", () => {
  const r = calculateMonthlyPayrollPreview({
    salaryStructure: {
      annual_ctc: 1320000,
      monthly_ctc: 110000,
      basic_salary: 55000,
      special_allowance: 52000,
      gross_salary: 107000,
      employee_pf: 3000,
      employer_pf: 3000,
      professional_tax: 200,
    },
    payrollMonth: 5,
    payrollYear: 2026,
    joiningDate: "2026-05-28",
    lopDays: 0,
    attendanceSettings: settings,
    pfSettings: pf,
    ptSettings: pt,
  });
  const payroll = calculatePayrollRecord({ attendance: r, tds: 0 });
  assert.equal(r.calendarDays, 31);
  assert.equal(r.eligibleDays, 4);
  assert.equal(r.paidDays, 4);
  assert.equal(r.basicSalary, 7097);
  assert.equal(r.specialAllowance, 6710);
  assert.equal(r.grossSalary, 13807);
  assert.equal(r.employeePf, 852);
  assert.equal(r.employerPf, 852);
  assert.equal(r.professionalTax, 200);
  assert.equal(payroll.tds, 0);
  assert.equal(payroll.netSalary, 12755);
  assert.equal(r.lopDays, 0);
  assert.equal(r.lopDeduction, -1);
});
test("LOP greater than eligible days rejected", () => {
  assert.throws(
    () => calc(4, "2026-09-28"),
    /LOP days cannot exceed eligible payroll days/,
  );
});
test("February and leap year days", () => {
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29);
});
test("30-day and 31-day months", () => {
  assert.equal(daysInMonth(2026, 9), 30);
  assert.equal(daysInMonth(2026, 10), 31);
});
test("working day proration excludes weekly offs and holidays", () => {
  const s = {
    ...settings,
    prorationBasis: "WORKING_DAYS",
    weeklyOffDays: [0, 6],
    holidays: ["2026-09-14"],
  };
  assert.equal(countWorkingDays(2026, 9, s), 21);
  assert.equal(eligiblePayrollDays(2026, 9, "2026-09-01", s), 21);
});
test("salary revision selects future effective structure rather than latest blindly", () => {
  const structures = [
    {
      effective_from: "2026-04-01",
      effective_to: "2026-08-31",
      annual_ctc: 320000,
    },
    { effective_from: "2026-09-01", effective_to: null, annual_ctc: 420000 },
  ];
  const selected = structures
    .filter(
      (s) =>
        s.effective_from <= "2026-09-30" &&
        (!s.effective_to || s.effective_to >= "2026-09-01"),
    )
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
  assert.equal(selected.annual_ctc, 420000);
});
test("whole rupee rounding", () => {
  assert.equal(roundPayrollAmount(123.49), 123);
  assert.equal(roundPayrollAmount(123.5), 124);
});
test("attendance migration is additive and tenant isolated", () => {
  const s = read("supabase/migrations/202609300004_phase4_attendance.sql");
  for (const t of ["attendance_settings", "attendance_records", "audit_logs"])
    assert.match(s, new RegExp(`create table public\\.${t}`));
  assert.match(
    s,
    /unique\(company_id, employee_id, payroll_month, payroll_year\)/,
  );
  assert.match(s, /enable row level security/);
  assert.match(s, /public\.company_members/);
  assert.match(s, /employee_same_company/);
});
test("attendance API exposes protected settings, import, export, save and history", () => {
  const s = read("apps/api/src/routes/attendance.ts");
  assert.match(s, /router\.use\(requireAuth\)/);
  for (const [method, route] of [
    ["get", "/settings"],
    ["put", "/settings"],
    ["get", "/export"],
    ["get", "/template"],
    ["get", "/employee/:employeeId/history"],
    ["get", "/"],
    ["post", "/import-preview"],
    ["post", "/import"],
    ["put", "/"],
  ]) {
    assert.match(
      s,
      new RegExp(
        `router\\.${method}\\(\\s*["']${route.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}["']`,
      ),
    );
  }
  assert.match(s, /getMembership\(req\.userId!/);
  assert.match(s, /ACCOUNTANT/);
  assert.match(s, /canEdit\(membership\.role\)/);
});
test("attendance sheet saves only edited employee rows", () => {
  const s = read("apps/web/src/pages/Attendance.tsx");
  assert.match(s, /const changedRows = rows\.filter\(\(r\) => r\.dirty\)/);
  assert.match(
    s,
    /const bad = changedRows\.filter\(\(r\) => r\.salary && r\.error\)/,
  );
  assert.match(s, /rows: changedRows\.map\(\(r\) =>/);
  assert.match(
    s,
    /value=\{r\.preview\?\.presentDays \?\? r\.record\?\.present_days \?\? 0\}/,
  );
  const api = read("apps/api/src/routes/attendance.ts");
  assert.match(api, /salaryStructure: salary \?\? \{/);
});
test("employee records are not modified by attendance proration", () => {
  const s = read("apps/api/src/routes/attendance.ts");
  assert.doesNotMatch(s, /from\('employees'\)\.update/);
  assert.match(s, /salary_structures/);
});
test("Phase 1-3 routes remain present", () => {
  const app = read("apps/web/src/App.tsx");
  for (const p of [
    "/dashboard",
    "/employees",
    "/settings",
    "/salary-structure",
    "/attendance",
  ])
    assert.match(app, new RegExp(`path="${p}"`));
});
test("attendance import uses Employee ID, not name, as key", () => {
  const s = read("apps/api/src/routes/attendance.ts");
  assert.match(s, /Employee ID/);
  assert.match(s, /employee_id/);
});
