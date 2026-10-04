export type CompanyRole = 'OWNER' | 'COMPANY_ADMIN' | 'HR' | 'ACCOUNTANT';
export type EmploymentStatus = 'ACTIVE' | 'INACTIVE' | 'ON_NOTICE' | 'TERMINATED';
export type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERN' | 'CONSULTANT';
export type PaymentFrequency = 'MONTHLY' | 'WEEKLY' | 'BIWEEKLY';
export interface Employee { id:string; company_id:string; employee_id:string; first_name:string; last_name:string; email:string|null; mobile:string|null; date_of_birth:string|null; gender:string|null; residential_address:string|null; emergency_contact_name:string|null; emergency_contact_phone:string|null; department_id:string|null; department_name:string|null; designation:string|null; date_of_joining:string; employment_type:EmploymentType; reporting_manager:string|null; employment_status:EmploymentStatus; last_working_date:string|null; work_location:string|null; annual_ctc:number|null; salary_effective_date:string|null; salary_payment_frequency:PaymentFrequency; salary_structure_assignment:string|null; pf_applicable:boolean; pt_applicable:boolean; tds_applicable:boolean; bank_account_holder_name:string|null; bank_name:string|null; bank_account_last4:string|null; ifsc_masked:string|null; pan_masked:string|null; uan_masked:string|null; pf_member_id_masked:string|null; previous_employer_name:string|null; previous_employer_taxable_salary:number|null; previous_employer_tds:number|null; previous_employment_start_date:string|null; previous_employment_end_date:string|null; created_at:string; updated_at:string; }
export * from './payroll.js';

export * from './attendance.js';

export * from './tax.js';

export * from './payrollRun.js';
export * from './compliance.js';
