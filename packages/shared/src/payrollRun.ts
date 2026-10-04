import { type MonthlyPayrollPreview } from "./attendance.ts";
import { roundPayrollAmount } from "./payroll.ts";

export interface PayrollAdjustmentTotals {
  earnings: number;
  deductions: number;
}
export interface PayrollRecordCalculationInput {
  attendance: MonthlyPayrollPreview;
  tds: number;
  otherDeductions?: number;
  adjustments?: PayrollAdjustmentTotals;
}
export interface PayrollRecordCalculation {
  basicSalary: number;
  specialAllowance: number;
  grossSalary: number;
  employeePf: number;
  employerPf: number;
  professionalTax: number;
  tds: number;
  otherDeductions: number;
  adjustmentEarnings: number;
  adjustmentDeductions: number;
  totalDeductions: number;
  netSalary: number;
  employerCost: number;
  adjustedGross: number;
  lopDeduction: number;
}
export function calculatePayrollRecord(
  input: PayrollRecordCalculationInput,
): PayrollRecordCalculation {
  const a = input.attendance;
  const adjustmentEarnings = Math.max(
    0,
    roundPayrollAmount(input.adjustments?.earnings ?? 0),
  );
  const adjustmentDeductions = Math.max(
    0,
    roundPayrollAmount(input.adjustments?.deductions ?? 0),
  );
  const tds = Math.max(0, roundPayrollAmount(input.tds));
  const otherDeductions = Math.max(
    0,
    roundPayrollAmount(input.otherDeductions ?? 0),
  );
  const adjustedGross = roundPayrollAmount(a.grossSalary + adjustmentEarnings);
  const totalDeductions = roundPayrollAmount(
    a.employeePf +
      a.professionalTax +
      tds +
      otherDeductions +
      adjustmentDeductions,
  );
  const netSalary = Math.max(
    0,
    roundPayrollAmount(adjustedGross - totalDeductions),
  );
  const employerCost = roundPayrollAmount(adjustedGross + a.employerPf);
  return {
    basicSalary: a.basicSalary,
    specialAllowance: a.specialAllowance,
    grossSalary: a.grossSalary,
    employeePf: a.employeePf,
    employerPf: a.employerPf,
    professionalTax: a.professionalTax,
    tds,
    otherDeductions,
    adjustmentEarnings,
    adjustmentDeductions,
    totalDeductions,
    netSalary,
    employerCost,
    adjustedGross,
    lopDeduction: a.lopDeduction,
  };
}
export function reconcilePayrollTotals(totals: {
  gross: number;
  employeePf: number;
  pt: number;
  tds: number;
  otherDeductions: number;
  adjustmentDeductions: number;
  net: number;
  employerPf: number;
  employerCost: number;
}) {
  const expectedNet = roundPayrollAmount(
    totals.gross -
      totals.employeePf -
      totals.pt -
      totals.tds -
      totals.otherDeductions -
      totals.adjustmentDeductions,
  );
  const expectedEmployerCost = roundPayrollAmount(
    totals.gross + totals.employerPf,
  );
  return {
    netMatches: expectedNet === roundPayrollAmount(totals.net),
    employerCostMatches:
      expectedEmployerCost === roundPayrollAmount(totals.employerCost),
    expectedNet,
    expectedEmployerCost,
  };
}
