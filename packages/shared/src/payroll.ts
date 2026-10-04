export interface PfSettings {
  employeePfRate: number;
  employerPfRate: number;
  pfWageCeiling: number;
  minimumBasic: number;
  basicPercentage: number;
  enabled?: boolean;
}
export interface PtSlab {
  min: number;
  max: number | null;
  amount: number;
}
export interface PtSettings {
  enabled: boolean;
  state: string | null;
  slabs: PtSlab[];
}
export interface SalaryCalculationInput {
  annualCtc: number;
  pfSettings: PfSettings;
  ptSettings: PtSettings;
}
export interface SalaryCalculationResult {
  annualCtc: number;
  monthlyCtc: number;
  basicSalary: number;
  specialAllowance: number;
  grossSalary: number;
  employeePf: number;
  employerPf: number;
  professionalTax: number;
  estimatedNetSalary: number;
  totalEmployerCost: number;
}
export function roundPayrollAmount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value + Number.EPSILON);
}
export function calculatePf(basicSalary: number, settings: PfSettings) {
  if (settings.enabled === false)
    return { pfWage: 0, employeePf: 0, employerPf: 0 };
  const wage = Math.min(
    Math.max(0, roundPayrollAmount(basicSalary)),
    Math.max(0, roundPayrollAmount(settings.pfWageCeiling)),
  );
  return {
    pfWage: wage,
    employeePf: roundPayrollAmount(
      (wage * Math.max(0, settings.employeePfRate)) / 100,
    ),
    employerPf: roundPayrollAmount(
      (wage * Math.max(0, settings.employerPfRate)) / 100,
    ),
  };
}
export function calculateProfessionalTax(
  grossSalary: number,
  settings: PtSettings,
): number {
  if (!settings.enabled) return 0;
  const gross = Math.max(0, roundPayrollAmount(grossSalary));
  const slab = settings.slabs.find(
    (s) => gross >= s.min && (s.max === null || gross <= s.max),
  );
  return roundPayrollAmount(slab?.amount ?? 0);
}
export function calculateSalaryStructure(
  input: SalaryCalculationInput,
): SalaryCalculationResult {
  if (!Number.isFinite(input.annualCtc) || input.annualCtc <= 0)
    throw new Error("Annual CTC must be greater than zero");
  const annualCtc = roundPayrollAmount(input.annualCtc);
  const monthlyCtc = roundPayrollAmount(annualCtc / 12);
  const minimumBasic = Math.max(
    0,
    roundPayrollAmount(input.pfSettings.minimumBasic),
  );
  const basicPercentage = Math.max(0, input.pfSettings.basicPercentage);
  const employerPfRate =
    input.pfSettings.enabled === false
      ? 0
      : Math.max(0, input.pfSettings.employerPfRate);
  const threshold = minimumBasic * (1 + employerPfRate / 100);
  const rawBasic =
    monthlyCtc <= threshold
      ? monthlyCtc / (1 + employerPfRate / 100)
      : Math.max(minimumBasic, (monthlyCtc * basicPercentage) / 100);
  const basicSalary = roundPayrollAmount(rawBasic);
  const pf = calculatePf(basicSalary, input.pfSettings);
  const specialAllowance = Math.max(
    0,
    roundPayrollAmount(monthlyCtc - basicSalary - pf.employerPf),
  );
  const grossSalary = roundPayrollAmount(basicSalary + specialAllowance);
  const professionalTax = calculateProfessionalTax(
    grossSalary,
    input.ptSettings,
  );
  const estimatedNetSalary = Math.max(
    0,
    roundPayrollAmount(grossSalary - pf.employeePf - professionalTax),
  );
  return {
    annualCtc,
    monthlyCtc,
    basicSalary,
    specialAllowance,
    grossSalary,
    employeePf: pf.employeePf,
    employerPf: pf.employerPf,
    professionalTax,
    estimatedNetSalary,
    totalEmployerCost: monthlyCtc,
  } as SalaryCalculationResult;
}
