export type TaxRegime = "NEW" | "OLD";
export type FirstMonthTdsMode = "FULL_MONTHLY" | "PRORATED_REDISTRIBUTE";

export interface TaxSlab {
  lowerLimit: number;
  upperLimit: number | null;
  rate: number;
}
export interface TaxRebate {
  incomeLimit: number;
  maximumRebate: number;
}
export interface TaxSettings {
  financialYear: string;
  regime: TaxRegime;
  standardDeduction: number;
  cessRate: number;
  slabs: TaxSlab[];
  rebate: TaxRebate;
  marginalReliefEnabled: boolean;
  marginalReliefIncomeLimit?: number;
}
export interface AnnualTaxInput {
  financialYear: string;
  taxRegime: TaxRegime;
  previousEmployerTaxableSalary: number;
  previousEmployerTds: number;
  currentEmployerProjectedTaxableSalary: number;
  otherTaxableIncome: number;
  otherTds: number;
  settings: TaxSettings;
  specialRateIncome?: number;
}
export interface AnnualTaxResult {
  totalIncome: number;
  standardDeduction: number;
  taxableIncome: number;
  normalRateIncome: number;
  specialRateIncome: number;
  taxBeforeRebate: number;
  rebate: number;
  marginalRelief: number;
  taxAfterRebate: number;
  cess: number;
  annualTaxLiability: number;
  previousTds: number;
  otherTds: number;
  remainingTds: number;
}
export interface TdsAllocationInput {
  annualTaxLiability: number;
  alreadyDeducted: number;
  payrollMonths: number;
  firstMonthPaidDays: number;
  firstMonthDays: number;
  firstMonthPaidDayFactor?: number;
  method: FirstMonthTdsMode;
}
export interface TdsScheduleRow {
  month: number;
  tdsAmount: number;
  deferredAmount: number;
  cumulativeTds: number;
  remainingTds: number;
}
export interface TdsAllocationResult {
  annualTdsToRecover: number;
  normalMonthlyTds: number;
  firstMonthTds: number;
  deferredTds: number;
  remainingMonths: number;
  additionalTdsPerMonth: number;
  finalMonthAdjustment: number;
  schedule: TdsScheduleRow[];
}

export function roundTaxAmount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value + Number.EPSILON);
}
export function calculateProgressiveTax(
  income: number,
  slabs: TaxSlab[],
  specialRateIncome = 0,
): number {
  const taxable = Math.max(0, roundTaxAmount(income));
  const special = Math.min(
    taxable,
    Math.max(0, roundTaxAmount(specialRateIncome)),
  );
  const normal = taxable - special;
  let tax = 0;
  const ordered = [...slabs].sort((a, b) => a.lowerLimit - b.lowerLimit);
  for (const slab of ordered) {
    const upper =
      slab.upperLimit === null ? normal : Math.min(normal, slab.upperLimit);
    const amount = Math.max(0, upper - slab.lowerLimit);
    if (amount > 0) tax += (amount * Math.max(0, slab.rate)) / 100;
    if (slab.upperLimit !== null && normal <= slab.upperLimit) break;
  }
  return roundTaxAmount(tax);
}
export function calculateRebate(
  taxableIncome: number,
  taxBeforeRebate: number,
  rebate: TaxRebate,
): number {
  if (taxableIncome <= rebate.incomeLimit)
    return Math.min(
      Math.max(0, taxBeforeRebate),
      Math.max(0, rebate.maximumRebate),
    );
  return 0;
}
export function calculateMarginalRelief(
  taxableIncome: number,
  taxAfterRebate: number,
  rebate: TaxRebate,
  enabled = true,
  configuredLimit?: number,
): number {
  if (!enabled) return 0;
  const threshold = configuredLimit ?? rebate.incomeLimit;
  if (taxableIncome <= threshold) return 0;
  const excessIncome = taxableIncome - threshold;
  return roundTaxAmount(Math.max(0, taxAfterRebate - excessIncome));
}
export function calculateAnnualTax(input: AnnualTaxInput): AnnualTaxResult {
  const previous = Math.max(
    0,
    roundTaxAmount(input.previousEmployerTaxableSalary),
  );
  const current = Math.max(
    0,
    roundTaxAmount(input.currentEmployerProjectedTaxableSalary),
  );
  const other = Math.max(0, roundTaxAmount(input.otherTaxableIncome));
  const totalIncome = roundTaxAmount(previous + current + other);
  const standardDeduction = Math.min(
    current,
    Math.max(0, roundTaxAmount(input.settings.standardDeduction)),
  );
  const taxableIncome = Math.max(
    0,
    roundTaxAmount(totalIncome - standardDeduction),
  );
  const specialRateIncome = Math.min(
    taxableIncome,
    Math.max(0, roundTaxAmount(input.specialRateIncome ?? 0)),
  );
  const taxBeforeRebate = calculateProgressiveTax(
    taxableIncome,
    input.settings.slabs,
    specialRateIncome,
  );
  const rebate = calculateRebate(
    taxableIncome,
    taxBeforeRebate,
    input.settings.rebate,
  );
  const taxAfterRebate = Math.max(0, roundTaxAmount(taxBeforeRebate - rebate));
  const marginalRelief = calculateMarginalRelief(
    taxableIncome,
    taxAfterRebate,
    input.settings.rebate,
    input.settings.marginalReliefEnabled,
    input.settings.marginalReliefIncomeLimit,
  );
  const taxAfterRelief = Math.max(
    0,
    roundTaxAmount(taxAfterRebate - marginalRelief),
  );
  const cess = roundTaxAmount(
    (taxAfterRelief * Math.max(0, input.settings.cessRate)) / 100,
  );
  const annualTaxLiability = roundTaxAmount(taxAfterRelief + cess);
  const previousTds = Math.max(0, roundTaxAmount(input.previousEmployerTds));
  const otherTds = Math.max(0, roundTaxAmount(input.otherTds));
  const remainingTds = Math.max(
    0,
    roundTaxAmount(annualTaxLiability - previousTds - otherTds),
  );
  return {
    totalIncome,
    standardDeduction,
    taxableIncome,
    normalRateIncome: taxableIncome - specialRateIncome,
    specialRateIncome,
    taxBeforeRebate,
    rebate,
    marginalRelief,
    taxAfterRebate: taxAfterRelief,
    cess,
    annualTaxLiability,
    previousTds,
    otherTds,
    remainingTds,
  };
}
export function calculateTdsSchedule(
  input: TdsAllocationInput,
): TdsAllocationResult {
  if (!Number.isInteger(input.payrollMonths) || input.payrollMonths < 0)
    throw new Error("Payroll months must be a non-negative integer");
  const firstMonthPaidDayFactor = input.firstMonthPaidDayFactor ?? 1;
  if (
    !Number.isFinite(input.firstMonthPaidDays) ||
    input.firstMonthPaidDays < 0 ||
    !Number.isFinite(input.firstMonthDays) ||
    input.firstMonthDays <= 0 ||
    input.firstMonthPaidDays > input.firstMonthDays ||
    !Number.isFinite(firstMonthPaidDayFactor) ||
    firstMonthPaidDayFactor < 0 ||
    firstMonthPaidDayFactor > 1
  )
    throw new Error("Invalid first-month TDS proration");
  const annualTdsToRecover = Math.max(
    0,
    roundTaxAmount(input.annualTaxLiability - input.alreadyDeducted),
  );
  if (input.payrollMonths === 0 || annualTdsToRecover === 0)
    return {
      annualTdsToRecover,
      normalMonthlyTds: 0,
      firstMonthTds: 0,
      deferredTds: 0,
      remainingMonths: 0,
      additionalTdsPerMonth: 0,
      finalMonthAdjustment: 0,
      schedule: [],
    };
  const normalMonthlyTds = roundTaxAmount(
    annualTdsToRecover / input.payrollMonths,
  );
  let firstMonthTds = normalMonthlyTds;
  let deferredTds = 0;
  if (input.method === "PRORATED_REDISTRIBUTE") {
    firstMonthTds = Math.min(
      annualTdsToRecover,
      roundTaxAmount(
        normalMonthlyTds *
          (input.firstMonthPaidDays / input.firstMonthDays) *
          firstMonthPaidDayFactor,
      ),
    );
    deferredTds = Math.max(0, normalMonthlyTds - firstMonthTds);
  }
  const remainingMonths = Math.max(0, input.payrollMonths - 1);
  const remainingMonthlyTds =
    remainingMonths > 0
      ? roundTaxAmount((annualTdsToRecover - firstMonthTds) / remainingMonths)
      : 0;
  const additionalTdsPerMonth =
    remainingMonths > 0 ? remainingMonthlyTds - normalMonthlyTds : 0;
  const schedule: TdsScheduleRow[] = [];
  let cumulative = 0;
  for (let i = 0; i < input.payrollMonths; i++) {
    let amount =
      i === 0 ? firstMonthTds : normalMonthlyTds + additionalTdsPerMonth;
    amount = Math.max(0, Math.min(amount, annualTdsToRecover - cumulative));
    cumulative = roundTaxAmount(cumulative + amount);
    schedule.push({
      month: i + 1,
      tdsAmount: amount,
      deferredAmount: i === 0 ? deferredTds : 0,
      cumulativeTds: cumulative,
      remainingTds: Math.max(0, annualTdsToRecover - cumulative),
    });
  }
  const diff = roundTaxAmount(annualTdsToRecover - cumulative);
  if (diff !== 0 && schedule.length) {
    const last = schedule[schedule.length - 1];
    last.tdsAmount = roundTaxAmount(last.tdsAmount + diff);
    last.cumulativeTds = annualTdsToRecover;
    last.remainingTds = 0;
  }
  const finalMonthAdjustment = schedule.length
    ? roundTaxAmount(
        schedule[schedule.length - 1].tdsAmount -
          (schedule.length > 1
            ? schedule[schedule.length - 2].tdsAmount
            : normalMonthlyTds),
      )
    : 0;
  return {
    annualTdsToRecover,
    normalMonthlyTds,
    firstMonthTds,
    deferredTds,
    remainingMonths,
    additionalTdsPerMonth,
    finalMonthAdjustment,
    schedule,
  };
}
