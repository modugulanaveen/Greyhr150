-- PayMate Phase 9: dashboard/report query indexes. Additive only; reporting is read-only.
create index if not exists payroll_runs_company_status_period_idx on public.payroll_runs(company_id,status,payroll_year desc,payroll_month desc);
create index if not exists payroll_records_company_run_employee_idx on public.payroll_records(company_id,payroll_run_id,employee_id);
create index if not exists employees_company_join_exit_idx on public.employees(company_id,date_of_joining,last_working_date);
create index if not exists employees_company_department_idx on public.employees(company_id,department_id);
create index if not exists salary_structures_company_employee_effective_idx on public.salary_structures(company_id,employee_id,effective_from desc);
create index if not exists attendance_company_period_employee_idx on public.attendance_records(company_id,payroll_year,payroll_month,employee_id);
create index if not exists payslips_company_period_status_idx on public.payslips(company_id,pay_period_year,pay_period_month,status);
create index if not exists statutory_liabilities_company_period_idx on public.statutory_liabilities(company_id,period_month,financial_year,statutory_type);
create index if not exists statutory_payments_company_liability_idx on public.statutory_payments(company_id,liability_id);
create index if not exists audit_logs_company_report_idx on public.audit_logs(company_id,entity_type,action,created_at desc);
