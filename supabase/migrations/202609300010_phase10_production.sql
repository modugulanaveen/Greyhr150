-- PayMate Phase 10: production hardening, settings and SaaS readiness. Additive only.

alter table public.companies
  add column if not exists trade_name text,
  add column if not exists company_email text,
  add column if not exists phone text,
  add column if not exists website text,
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists pin_code text,
  add column if not exists gstin text,
  add column if not exists pan text,
  add column if not exists logo_path text;

alter table public.company_members
  add column if not exists display_name text,
  add column if not exists email text,
  add column if not exists status text not null default 'ACTIVE',
  add column if not exists invited_at timestamptz,
  add column if not exists last_login_at timestamptz,
  add column if not exists deactivated_at timestamptz;

alter table public.company_members drop constraint if exists company_members_status_check;
alter table public.company_members add constraint company_members_status_check check (status in ('ACTIVE','INVITED','SUSPENDED','DEACTIVATED'));

create index if not exists company_members_company_email_idx on public.company_members(company_id,email);
create index if not exists company_members_company_status_idx on public.company_members(company_id,status);
create index if not exists company_members_user_status_idx on public.company_members(user_id,status);
create index if not exists companies_created_idx on public.companies(created_at desc);

-- Existing memberships are active unless explicitly deactivated later.
update public.company_members set status='ACTIVE' where status is null;
update public.company_members cm set email=u.email from auth.users u where cm.email is null and cm.user_id=u.id;

-- Prevent authenticated clients from reading a deactivated tenant membership through Supabase RLS.
drop policy if exists "members read own memberships" on public.company_members;
create policy "members read active memberships" on public.company_members
  for select to authenticated
  using (user_id = (select auth.uid()) and status='ACTIVE');

-- Audit history is append-only. Service-role code may insert, but no API path may mutate history.
create or replace function public.prevent_audit_mutation() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'Audit history is immutable';
end; $$;
drop trigger if exists audit_logs_immutable on public.audit_logs;
create trigger audit_logs_immutable before update or delete on public.audit_logs
for each row execute function public.prevent_audit_mutation();

drop trigger if exists payroll_audit_logs_immutable on public.payroll_audit_logs;
create trigger payroll_audit_logs_immutable before update or delete on public.payroll_audit_logs
for each row execute function public.prevent_audit_mutation();

drop trigger if exists compliance_audit_logs_immutable on public.compliance_audit_logs;
create trigger compliance_audit_logs_immutable before update or delete on public.compliance_audit_logs
for each row execute function public.prevent_audit_mutation();

-- Company branding is sensitive and remains private.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('company-branding','company-branding',false,2097152,array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public=false,file_size_limit=2097152,allowed_mime_types=excluded.allowed_mime_types;
create policy "admins read company branding" on storage.objects
for select to authenticated
using (bucket_id='company-branding' and exists(
  select 1 from public.company_members cm
  where cm.company_id::text=(storage.foldername(name))[1]
    and cm.user_id=(select auth.uid())
    and cm.status='ACTIVE'
    and cm.role in ('OWNER','COMPANY_ADMIN')
));

-- SaaS subscription catalog. No payment processing is implemented in Phase 10.
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check(code in ('FREE','STARTER','PRO','ENTERPRISE')),
  name text not null,
  description text,
  employee_limit integer check(employee_limit is null or employee_limit > 0),
  user_limit integer check(user_limit is null or user_limit > 0),
  payslip_limit integer check(payslip_limit is null or payslip_limit > 0),
  created_at timestamptz not null default now()
);
insert into public.plans(code,name,description,employee_limit,user_limit,payslip_limit) values
('FREE','Free','Subscription-ready free plan',50,5,500),
('STARTER','Starter','Subscription-ready starter plan',250,15,2500),
('PRO','Pro','Subscription-ready professional plan',1000,50,10000),
('ENTERPRISE','Enterprise','Configurable enterprise plan',null,null,null)
on conflict(code) do nothing;

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  status text not null default 'TRIAL' check(status in ('TRIAL','ACTIVE','PAST_DUE','CANCELLED','EXPIRED')),
  start_date date not null default current_date,
  end_date date,
  trial_start date,
  trial_end date,
  billing_customer_id text,
  billing_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(end_date is null or end_date >= start_date)
);
create index if not exists subscriptions_company_status_idx on public.subscriptions(company_id,status);
create trigger subscriptions_updated_at before update on public.subscriptions for each row execute function public.touch_updated_at();

create table if not exists public.usage_metrics (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  metric_date date not null default current_date,
  employees_count integer not null default 0 check(employees_count >= 0),
  users_count integer not null default 0 check(users_count >= 0),
  payroll_runs_count integer not null default 0 check(payroll_runs_count >= 0),
  payslips_count integer not null default 0 check(payslips_count >= 0),
  storage_bytes bigint not null default 0 check(storage_bytes >= 0),
  created_at timestamptz not null default now(),
  unique(company_id,metric_date)
);
create index if not exists usage_metrics_company_date_idx on public.usage_metrics(company_id,metric_date desc);

alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.usage_metrics enable row level security;
create policy "authenticated read plans" on public.plans for select to authenticated using (true);
create policy "members read subscription" on public.subscriptions for select to authenticated using(exists(select 1 from public.company_members cm where cm.company_id=subscriptions.company_id and cm.user_id=(select auth.uid()) and cm.status='ACTIVE'));
create policy "admins manage subscription" on public.subscriptions for all to authenticated using(exists(select 1 from public.company_members cm where cm.company_id=subscriptions.company_id and cm.user_id=(select auth.uid()) and cm.status='ACTIVE' and cm.role in ('OWNER','COMPANY_ADMIN'))) with check(exists(select 1 from public.company_members cm where cm.company_id=subscriptions.company_id and cm.user_id=(select auth.uid()) and cm.status='ACTIVE' and cm.role in ('OWNER','COMPANY_ADMIN')));
create policy "members read usage metrics" on public.usage_metrics for select to authenticated using(exists(select 1 from public.company_members cm where cm.company_id=usage_metrics.company_id and cm.user_id=(select auth.uid()) and cm.status='ACTIVE'));
create policy "admins manage usage metrics" on public.usage_metrics for all to authenticated using(exists(select 1 from public.company_members cm where cm.company_id=usage_metrics.company_id and cm.user_id=(select auth.uid()) and cm.status='ACTIVE' and cm.role in ('OWNER','COMPANY_ADMIN'))) with check(exists(select 1 from public.company_members cm where cm.company_id=usage_metrics.company_id and cm.user_id=(select auth.uid()) and cm.status='ACTIVE' and cm.role in ('OWNER','COMPANY_ADMIN')));

-- Additional tenant/query indexes used by settings, health and audit screens.
create index if not exists employee_documents_company_created_idx on public.employee_documents(company_id,created_at desc);
create index if not exists statutory_rules_company_type_effective_idx on public.statutory_rules(company_id,statutory_type,effective_from desc);
create index if not exists ecr_exports_company_created_idx on public.ecr_exports(company_id,created_at desc);
create index if not exists compliance_audit_company_action_idx on public.compliance_audit_logs(company_id,action,created_at desc);
