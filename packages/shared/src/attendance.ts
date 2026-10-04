import {
  calculatePf,
  calculateProfessionalTax,
  roundPayrollAmount,
  type PfSettings,
  type PtSettings,
} from "./payroll.ts";

export type ProrationBasis = "CALENDAR_DAYS" | "WORKING_DAYS";
export type PfCalculationBasis = "ACTUAL_ADJUSTED_WAGES" | "CONFIGURED_PF_WAGE";

export interface AttendanceSettings {
  prorationBasis: ProrationBasis;
  weeklyOffDays: number[];
  holidays: string[];
  pfCalculationBasis: PfCalculationBasis;
}

export interface MonthlySalaryStructure {
  annual_ctc: number;
  monthly_ctc: number;
  basic_salary: number;
  special_allowance: number;
  gross_salary: number;
  employee_pf: number;
  employer_pf: number;
  professional_tax: number;
}

export interface MonthlyPayrollPreviewInput {
  salaryStructure: MonthlySalaryStructure;
  payrollMonth: number;
  payrollYear: number;
  joiningDate: string;
  lopDays: number;
  presentDays?: number;
  paidLeaveDays?: number;
  attendanceSettings: AttendanceSettings;
  pfSettings: PfSettings;
  ptSettings: PtSettings;
}

export interface MonthlyPayrollPreview {
  eligibleDays: number;
  workingDays: number;
  calendarDays: number;
  paidDays: number;
  lopDays: number;
  presentDays: number;
  paidLeaveDays: number;
  basicSalary: number;
  specialAllowance: number;
  grossSalary: number;
  employeePf: number;
  employerPf: number;
  pfWage: number;
  professionalTax: number;
  estimatedNetSalary: number;
  totalEmployerCost: number;
  lopDeduction: number;
  originalGross: number;
}

export function daysInMonth(year: number, month: number): number {
  if (
    !Number.isInteger(year) ||
    year < 1900 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  )
    throw new Error("Invalid payroll month");
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function countWorkingDays(
  year: number,
  month: number,
  settings: AttendanceSettings,
  startDay = 1,
  endDay = daysInMonth(year, month),
): number {
  const offs = new Set(settings.weeklyOffDays ?? [0, 6]);
  const holidays = new Set(settings.holidays ?? []);
  let count = 0;
  for (let day = startDay; day <= endDay; day += 1) {
    const date = new Date(Date.UTC(year, month - 1, day));
    const iso = isoDate(year, month, day);
    if (!offs.has(date.getUTCDay()) && !holidays.has(iso)) count += 1;
  }
  return count;
}

export function eligiblePayrollDays(
  year: number,
  month: number,
  joiningDate: string,
  settings: AttendanceSettings,
): number {
  const monthStart = isoDate(year, month, 1);
  const monthEnd = isoDate(year, month, daysInMonth(year, month));
  if (joiningDate > monthEnd) return 0;
  const start =
    joiningDate > monthStart
      ? new Date(`${joiningDate}T00:00:00Z`).getUTCDate()
      : 1;
  if (settings.prorationBasis === "WORKING_DAYS")
    return countWorkingDays(
      year,
      month,
      settings,
      start,
      daysInMonth(year, month),
    );
  return daysInMonth(year, month) - start + 1;
}

export function calculateMonthlyPayrollPreview(
  input: MonthlyPayrollPreviewInput,
): MonthlyPayrollPreview {
  const {
    salaryStructure,
    payrollMonth,
    payrollYear,
    joiningDate,
    attendanceSettings,
    pfSettings,
    ptSettings,
  } = input;
  if (!Number.isInteger(payrollMonth) || payrollMonth < 1 || payrollMonth > 12)
    throw new Error("Invalid payroll month");
  if (!Number.isInteger(payrollYear) || payrollYear < 1900)
    throw new Error("Invalid payroll year");
  if (!Number.isFinite(input.lopDays) || input.lopDays < 0)
    throw new Error("LOP days cannot be negative");
  const calendarDays = daysInMonth(payrollYear, payrollMonth);
  const workingDays = countWorkingDays(
    payrollYear,
    payrollMonth,
    attendanceSettings,
  );
  const eligibleDays = eligiblePayrollDays(
    payrollYear,
    payrollMonth,
    joiningDate,
    attendanceSettings,
  );
  const lopDays = roundPayrollAmount(input.lopDays);
  if (lopDays > eligibleDays)
    throw new Error("LOP days cannot exceed eligible payroll days");
  const paidDays = Math.max(0, eligibleDays - lopDays);
  const divisor =
    attendanceSettings.prorationBasis === "WORKING_DAYS"
      ? workingDays
      : calendarDays;
  const ratio = divisor > 0 ? paidDays / divisor : 0;
  const basicSalary = roundPayrollAmount(
    Number(salaryStructure.basic_salary) * ratio,
  );
  const specialAllowance = roundPayrollAmount(
    Number(salaryStructure.special_allowance) * ratio,
  );
  const originalGross = roundPayrollAmount(
    Number(salaryStructure.gross_salary),
  );
  const grossSalary = roundPayrollAmount(basicSalary + specialAllowance);
  const eligibleGross = roundPayrollAmount(
    (originalGross * eligibleDays) / Math.max(1, divisor),
  );
  const lopDeduction = roundPayrollAmount(eligibleGross - grossSalary);
  let employeePf = 0;
  let employerPf = 0;
  let pfWage = 0;
  if (pfSettings.enabled !== false) {
    if (attendanceSettings.pfCalculationBasis === "CONFIGURED_PF_WAGE") {
      const configuredWage = Math.min(
        Math.max(0, roundPayrollAmount(Number(salaryStructure.basic_salary))),
        Math.max(0, roundPayrollAmount(pfSettings.pfWageCeiling)),
      );
      pfWage = roundPayrollAmount(configuredWage * ratio);
      employeePf = roundPayrollAmount(
        (pfWage * Math.max(0, pfSettings.employeePfRate)) / 100,
      );
      employerPf = roundPayrollAmount(
        (pfWage * Math.max(0, pfSettings.employerPfRate)) / 100,
      );
    } else {
      const pf = calculatePf(basicSalary, pfSettings);
      pfWage = pf.pfWage;
      employeePf = pf.employeePf;
      employerPf = pf.employerPf;
    }
  }
  const professionalTax =
    paidDays > 0 ? calculateProfessionalTax(originalGross, ptSettings) : 0;
  const estimatedNetSalary = Math.max(
    0,
    roundPayrollAmount(grossSalary - employeePf - professionalTax),
  );
  const totalEmployerCost = roundPayrollAmount(grossSalary + employerPf);
  const eligible = Math.max(0, eligibleDays);
  const presentDays =
    input.presentDays === undefined
      ? Math.max(
          0,
          paidDays - Math.max(0, roundPayrollAmount(input.paidLeaveDays ?? 0)),
        )
      : Math.max(0, roundPayrollAmount(input.presentDays));
  const paidLeaveDays =
    input.paidLeaveDays === undefined
      ? Math.max(0, paidDays - presentDays)
      : Math.max(0, roundPayrollAmount(input.paidLeaveDays));
  if (presentDays + paidLeaveDays + lopDays > eligible)
    throw new Error(
      "Present days, paid leave and LOP cannot exceed eligible payroll days",
    );
  return {
    eligibleDays: eligible,
    workingDays,
    calendarDays,
    paidDays,
    lopDays,
    presentDays,
    paidLeaveDays,
    basicSalary,
    specialAllowance,
    grossSalary,
    employeePf,
    employerPf,
    pfWage,
    professionalTax,
    estimatedNetSalary,
    totalEmployerCost,
    lopDeduction,
    originalGross,
  };
}
