-- PayMate Phase 4: Attendance, LOP and monthly salary proration.
create table public.attendance_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  proration_basis text not null default 'CALENDAR_DAYS' check(proration_basis in ('CALENDAR_DAYS','WORKING_DAYS')),
  weekly_off_days jsonb not null default '[0,6]'::jsonb,
  holidays jsonb not null default '[]'::jsonb,
  pf_calculation_basis text not null default 'ACTUAL_ADJUSTED_WAGES' check(pf_calculation_basis in ('ACTUAL_ADJUSTED_WAGES','CONFIGURED_PF_WAGE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_weekly_off_array check(jsonb_typeof(weekly_off_days)='array'),
  constraint attendance_holidays_array check(jsonb_typeof(holidays)='array')
);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  payroll_month integer not null check(payroll_month between 1 and 12),
  payroll_year integer not null check(payroll_year between 1900 and 2200),
  working_days integer not null default 0 check(working_days >= 0),
  present_days integer not null default 0 check(present_days >= 0),
  paid_leave_days integer not null default 0 check(paid_leave_days >= 0),
  lop_days integer not null default 0 check(lop_days >= 0),
  paid_days integer not null default 0 check(paid_days >= 0),
  eligible_days integer not null default 0 check(eligible_days >= 0),
  status text not null default 'DRAFT' check(status in ('DRAFT','PROCESSED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, employee_id, payroll_month, payroll_year),
  constraint attendance_days_consistent check(present_days + paid_leave_days + lop_days <= eligible_days),
  constraint attendance_paid_consistent check(paid_days = greatest(eligible_days - lop_days, 0))
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index attendance_records_company_period_idx on public.attendance_records(company_id, payroll_year, payroll_month);
create index attendance_records_employee_period_idx on public.attendance_records(employee_id, payroll_year desc, payroll_month desc);
create index audit_logs_company_created_idx on public.audit_logs(company_id, created_at desc);

create or replace function public.employee_same_company() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.employees e where e.id = new.employee_id and e.company_id = new.company_id) then
    raise exception 'Employee does not belong to company';
  end if;
  return new;
end; $$;
create trigger attendance_employee_company before insert or update on public.attendance_records for each row execute function public.employee_same_company();
create trigger attendance_settings_updated_at before update on public.attendance_settings for each row execute function public.touch_updated_at();
create trigger attendance_records_updated_at before update on public.attendance_records for each row execute function public.touch_updated_at();

alter table public.attendance_settings enable row level security;
alter table public.attendance_records enable row level security;
alter table public.audit_logs enable row level security;

create policy "members read attendance settings" on public.attendance_settings for select to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=attendance_settings.company_id and cm.user_id=(select auth.uid())));
create policy "admins manage attendance settings" on public.attendance_settings for all to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=attendance_settings.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR'))) with check (exists(select 1 from public.company_members cm where cm.company_id=attendance_settings.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR')));
create policy "members read attendance" on public.attendance_records for select to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=attendance_records.company_id and cm.user_id=(select auth.uid())));
create policy "hr manage attendance" on public.attendance_records for all to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=attendance_records.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR','ACCOUNTANT'))) with check (exists(select 1 from public.company_members cm where cm.company_id=attendance_records.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR','ACCOUNTANT')));
create policy "members read audit logs" on public.audit_logs for select to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=audit_logs.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR')));
create policy "server inserts audit logs" on public.audit_logs for insert to authenticated with check (user_id=(select auth.uid()) and exists(select 1 from public.company_members cm where cm.company_id=audit_logs.company_id and cm.user_id=(select auth.uid())));
