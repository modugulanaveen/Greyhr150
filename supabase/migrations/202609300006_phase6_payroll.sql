-- PayMate Phase 6: monthly payroll runs and immutable payroll snapshots. Additive only.
alter table public.payroll_settings add column if not exists allow_future_payroll boolean not null default false;
create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  payroll_month integer not null check(payroll_month between 1 and 12),
  payroll_year integer not null check(payroll_year between 1900 and 2200),
  status text not null default 'DRAFT' check(status in ('DRAFT','CALCULATING','CALCULATED','UNDER_REVIEW','APPROVED','LOCKED')),
  employee_count integer not null default 0 check(employee_count >= 0),
  gross_total numeric(15,2) not null default 0 check(gross_total >= 0),
  employee_pf_total numeric(15,2) not null default 0 check(employee_pf_total >= 0),
  employer_pf_total numeric(15,2) not null default 0 check(employer_pf_total >= 0),
  pt_total numeric(15,2) not null default 0 check(pt_total >= 0),
  tds_total numeric(15,2) not null default 0 check(tds_total >= 0),
  deduction_total numeric(15,2) not null default 0 check(deduction_total >= 0),
  net_salary_total numeric(15,2) not null default 0 check(net_salary_total >= 0),
  employer_cost_total numeric(15,2) not null default 0 check(employer_cost_total >= 0),
  adjustment_earnings_total numeric(15,2) not null default 0 check(adjustment_earnings_total >= 0),
  adjustment_deductions_total numeric(15,2) not null default 0 check(adjustment_deductions_total >= 0),
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  locked_by uuid references auth.users(id),
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,payroll_month,payroll_year)
);
create table public.payroll_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  salary_structure_id uuid references public.salary_structures(id) on delete restrict,
  attendance_record_id uuid references public.attendance_records(id) on delete restrict,
  paid_days numeric(8,2) not null default 0 check(paid_days >= 0),
  basic_salary numeric(15,2) not null default 0 check(basic_salary >= 0),
  special_allowance numeric(15,2) not null default 0 check(special_allowance >= 0),
  gross_salary numeric(15,2) not null default 0 check(gross_salary >= 0),
  lop_days numeric(8,2) not null default 0 check(lop_days >= 0),
  lop_deduction numeric(15,2) not null default 0 check(lop_deduction >= 0),
  adjusted_gross numeric(15,2) not null default 0 check(adjusted_gross >= 0),
  employee_pf numeric(15,2) not null default 0 check(employee_pf >= 0),
  employer_pf numeric(15,2) not null default 0 check(employer_pf >= 0),
  professional_tax numeric(15,2) not null default 0 check(professional_tax >= 0),
  tds numeric(15,2) not null default 0 check(tds >= 0),
  adjustment_earnings numeric(15,2) not null default 0 check(adjustment_earnings >= 0),
  adjustment_deductions numeric(15,2) not null default 0 check(adjustment_deductions >= 0),
  other_deductions numeric(15,2) not null default 0 check(other_deductions >= 0),
  total_deductions numeric(15,2) not null default 0 check(total_deductions >= 0),
  net_salary numeric(15,2) not null default 0 check(net_salary >= 0),
  employer_cost numeric(15,2) not null default 0 check(employer_cost >= 0),
  status text not null default 'CALCULATED' check(status in ('CALCULATED','REVIEW','APPROVED','LOCKED')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,payroll_run_id,employee_id)
);
create table public.payroll_adjustments (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade, employee_id uuid not null references public.employees(id) on delete restrict,
  adjustment_type text not null check(adjustment_type in ('BONUS','INCENTIVE','REIMBURSEMENT','OTHER_EARNINGS','OTHER_DEDUCTION')),
  amount numeric(15,2) not null check(amount > 0), reason text not null, notes text, created_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create table public.payroll_validation_errors (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade, employee_id uuid references public.employees(id) on delete restrict,
  severity text not null check(severity in ('ERROR','WARNING','INFO')), code text not null, message text not null, acknowledged boolean not null default false, created_at timestamptz not null default now()
);
create table public.payroll_audit_logs (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade, employee_id uuid references public.employees(id) on delete restrict,
  user_id uuid references auth.users(id), action text not null, previous_status text, new_status text, reason text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index payroll_runs_company_period_idx on public.payroll_runs(company_id,payroll_year desc,payroll_month desc);
create index payroll_records_run_idx on public.payroll_records(company_id,payroll_run_id);
create index payroll_records_employee_idx on public.payroll_records(company_id,employee_id);
create index payroll_validation_run_idx on public.payroll_validation_errors(company_id,payroll_run_id,severity);
create index payroll_audit_run_idx on public.payroll_audit_logs(company_id,payroll_run_id,created_at desc);
create or replace function public.payroll_employee_same_company() returns trigger language plpgsql as $$ begin
  if new.employee_id is not null and not exists(select 1 from public.employees e where e.id=new.employee_id and e.company_id=new.company_id) then raise exception 'Employee does not belong to company'; end if;
  if not exists(select 1 from public.payroll_runs p where p.id=new.payroll_run_id and p.company_id=new.company_id) then raise exception 'Payroll run does not belong to company'; end if;
  return new; end; $$;
create trigger payroll_records_company before insert or update on public.payroll_records for each row execute function public.payroll_employee_same_company();
create trigger payroll_adjustments_employee_company before insert or update on public.payroll_adjustments for each row execute function public.payroll_employee_same_company();
create trigger payroll_validation_employee_company before insert or update on public.payroll_validation_errors for each row execute function public.payroll_employee_same_company();
create trigger payroll_audit_employee_company before insert or update on public.payroll_audit_logs for each row execute function public.payroll_employee_same_company();
create trigger payroll_runs_updated_at before update on public.payroll_runs for each row execute function public.touch_updated_at();
create trigger payroll_records_updated_at before update on public.payroll_records for each row execute function public.touch_updated_at();
alter table public.payroll_runs enable row level security; alter table public.payroll_records enable row level security; alter table public.payroll_adjustments enable row level security; alter table public.payroll_validation_errors enable row level security; alter table public.payroll_audit_logs enable row level security;
create policy "members read payroll runs" on public.payroll_runs for select to authenticated using(exists(select 1 from public.company_members cm where cm.company_id=payroll_runs.company_id and cm.user_id=(select auth.uid())));
create policy "payroll admins manage runs" on public.payroll_runs for all to authenticated using(exists(select 1 from public.company_members cm where cm.company_id=payroll_runs.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR','ACCOUNTANT'))) with check(exists(select 1 from public.company_members cm where cm.company_id=payroll_runs.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR','ACCOUNTANT')));
create policy "members read payroll records" on public.payroll_records for select to authenticated using(exists(select 1 from public.company_members cm where cm.company_id=payroll_records.company_id and cm.user_id=(select auth.uid())));
create policy "payroll admins manage records" on public.payroll_records for all to authenticated using(exists(select 1 from public.company_members cm where cm.company_id=payroll_records.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR','ACCOUNTANT'))) with check(exists(select 1 from public.company_members cm where cm.company_id=payroll_records.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR','ACCOUNTANT')));
create policy "members read payroll adjustments" on public.payroll_adjustments for select to authenticated using(exists(select 1 from public.company_members cm where cm.company_id=payroll_adjustments.company_id and cm.user_id=(select auth.uid())));
create policy "payroll admins manage adjustments" on public.payroll_adjustments for all to authenticated using(exists(select 1 from public.company_members cm where cm.company_id=payroll_adjustments.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR','ACCOUNTANT'))) with check(exists(select 1 from public.company_members cm where cm.company_id=payroll_adjustments.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR','ACCOUNTANT')));
create policy "members read payroll validation" on public.payroll_validation_errors for select to authenticated using(exists(select 1 from public.company_members cm where cm.company_id=payroll_validation_errors.company_id and cm.user_id=(select auth.uid())));
create policy "payroll admins manage validation" on public.payroll_validation_errors for all to authenticated using(exists(select 1 from public.company_members cm where cm.company_id=payroll_validation_errors.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR','ACCOUNTANT'))) with check(exists(select 1 from public.company_members cm where cm.company_id=payroll_validation_errors.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR','ACCOUNTANT')));
create policy "admins read payroll audit" on public.payroll_audit_logs for select to authenticated using(exists(select 1 from public.company_members cm where cm.company_id=payroll_audit_logs.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR')));
create policy "members insert payroll audit" on public.payroll_audit_logs for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.company_members cm where cm.company_id=payroll_audit_logs.company_id and cm.user_id=(select auth.uid())));
