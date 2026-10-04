-- PayMate Phase 7: payslips, private storage and company branding. Additive only.
create table public.payslip_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  company_logo_path text,
  company_name text,
  company_address text,
  company_phone text,
  company_email text,
  company_website text,
  payslip_footer text default 'This is a computer-generated payslip.',
  show_pan boolean not null default true,
  show_uan boolean not null default true,
  show_bank_account boolean not null default true,
  mask_bank_account boolean not null default true,
  mask_pan boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger payslip_settings_updated_at before update on public.payslip_settings for each row execute function public.touch_updated_at();

create table public.payslips (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  payroll_run_id uuid not null references public.payroll_runs(id) on delete restrict,
  payroll_record_id uuid not null references public.payroll_records(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  pay_period_month integer not null check(pay_period_month between 1 and 12),
  pay_period_year integer not null check(pay_period_year between 1900 and 2200),
  financial_year text not null,
  file_path text,
  file_name text not null,
  status text not null default 'NOT_GENERATED' check(status in ('NOT_GENERATED','GENERATING','GENERATED','FAILED')),
  generated_at timestamptz,
  generated_by uuid references auth.users(id),
  file_hash text,
  version integer not null default 1 check(version > 0),
  error_message text,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(payroll_record_id, version)
);
create trigger payslips_updated_at before update on public.payslips for each row execute function public.touch_updated_at();
create index payslips_company_idx on public.payslips(company_id);
create index payslips_run_idx on public.payslips(company_id,payroll_run_id);
create index payslips_employee_idx on public.payslips(company_id,employee_id);
create index payslips_period_idx on public.payslips(company_id,pay_period_year,pay_period_month);
create index payslips_status_idx on public.payslips(company_id,status);

create or replace function public.payslip_employee_company_check() returns trigger language plpgsql security definer set search_path = public as $$
declare emp_company uuid; run_company uuid; record_company uuid;
begin
  select company_id into emp_company from public.employees where id = new.employee_id;
  select company_id into run_company from public.payroll_runs where id = new.payroll_run_id;
  select company_id into record_company from public.payroll_records where id = new.payroll_record_id;
  if emp_company is null or emp_company <> new.company_id or run_company is null or run_company <> new.company_id or record_company is null or record_company <> new.company_id then
    raise exception 'Payslip company mismatch';
  end if;
  return new;
end; $$;
create trigger payslip_employee_company before insert or update on public.payslips for each row execute function public.payslip_employee_company_check();

alter table public.payslip_settings enable row level security;
alter table public.payslips enable row level security;
create policy "members read payslip settings" on public.payslip_settings for select to authenticated using(exists(select 1 from public.company_members cm where cm.company_id=payslip_settings.company_id and cm.user_id=(select auth.uid())));
create policy "admins manage payslip settings" on public.payslip_settings for all to authenticated using(exists(select 1 from public.company_members cm where cm.company_id=payslip_settings.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN'))) with check(exists(select 1 from public.company_members cm where cm.company_id=payslip_settings.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN')));
create policy "members read payslips" on public.payslips for select to authenticated using(exists(select 1 from public.company_members cm where cm.company_id=payslips.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR','ACCOUNTANT')));

insert into storage.buckets(id,name,public) values('payslips','payslips',false) on conflict(id) do nothing;
insert into storage.buckets(id,name,public) values('payslip-branding','payslip-branding',false) on conflict(id) do nothing;
create policy "members read payslip files" on storage.objects for select to authenticated using(bucket_id='payslips' and exists(select 1 from public.company_members cm where cm.company_id::text = (storage.foldername(name))[2] and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR','ACCOUNTANT')));
create policy "admins read branding" on storage.objects for select to authenticated using(bucket_id='payslip-branding' and exists(select 1 from public.company_members cm where cm.company_id::text = (storage.foldername(name))[2] and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN')));
