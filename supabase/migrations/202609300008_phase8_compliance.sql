create table public.statutory_rules (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 statutory_type text not null check(statutory_type in ('PF','PT','TDS')), state text, effective_from date not null, effective_to date,
 due_day integer check(due_day between 1 and 31), due_month_rule text, config jsonb not null default '{}'::jsonb,
 created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(effective_to is null or effective_to>=effective_from)
);
create index statutory_rules_lookup_idx on public.statutory_rules(company_id,statutory_type,effective_from desc);
create table public.ecr_exports (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 payroll_run_id uuid not null references public.payroll_runs(id) on delete restrict, financial_year text not null, month integer not null check(month between 1 and 12),
 employee_count integer not null default 0, file_path text, file_name text not null, status text not null default 'PREPARED' check(status in ('PREPARED','DOWNLOADED','SUBMITTED','FAILED','OUTDATED')),
 prepared_by uuid references auth.users(id), prepared_at timestamptz, version integer not null default 1, error_message text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(payroll_run_id,version)
);
create table public.statutory_liabilities (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 payroll_run_id uuid not null references public.payroll_runs(id) on delete restrict, statutory_type text not null check(statutory_type in ('PF','PT','TDS')),
 financial_year text not null, period_month integer not null check(period_month between 1 and 12), amount numeric(15,2) not null default 0 check(amount>=0), status text not null default 'PENDING' check(status in ('PENDING','PARTIALLY_PAID','PAID','OVERDUE','NOT_APPLICABLE','OUTDATED')),
 due_date date, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,payroll_run_id,statutory_type)
);
create table public.statutory_payments (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 liability_id uuid not null references public.statutory_liabilities(id) on delete cascade, amount numeric(15,2) not null check(amount>0), payment_date date not null,
 reference_number text, bank_reference text, attachment_path text, notes text, created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.compliance_audit_logs (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade, user_id uuid references auth.users(id), action text not null,
 entity_type text not null, entity_id uuid, payroll_run_id uuid references public.payroll_runs(id) on delete set null, before_value jsonb, after_value jsonb, created_at timestamptz not null default now()
);
create index statutory_liability_company_period_idx on public.statutory_liabilities(company_id,period_month,financial_year);
create index statutory_payment_liability_idx on public.statutory_payments(company_id,liability_id);
create index compliance_audit_idx on public.compliance_audit_logs(company_id,created_at desc);
create trigger statutory_rules_updated_at before update on public.statutory_rules for each row execute function public.touch_updated_at();
create trigger ecr_exports_updated_at before update on public.ecr_exports for each row execute function public.touch_updated_at();
create trigger statutory_liabilities_updated_at before update on public.statutory_liabilities for each row execute function public.touch_updated_at();
create trigger statutory_payments_updated_at before update on public.statutory_payments for each row execute function public.touch_updated_at();
alter table public.statutory_rules enable row level security; alter table public.ecr_exports enable row level security; alter table public.statutory_liabilities enable row level security; alter table public.statutory_payments enable row level security; alter table public.compliance_audit_logs enable row level security;
create policy "members read statutory rules" on public.statutory_rules for select to authenticated using(exists(select 1 from public.company_members cm where cm.company_id=statutory_rules.company_id and cm.user_id=(select auth.uid())));
create policy "admins manage statutory rules" on public.statutory_rules for all to authenticated using(exists(select 1 from public.company_members cm where cm.company_id=statutory_rules.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN'))) with check(exists(select 1 from public.company_members cm where cm.company_id=statutory_rules.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN')));
create policy "members read ecr exports" on public.ecr_exports for select to authenticated using(exists(select 1 from public.company_members cm where cm.company_id=ecr_exports.company_id and cm.user_id=(select auth.uid())));
create policy "members read liabilities" on public.statutory_liabilities for select to authenticated using(exists(select 1 from public.company_members cm where cm.company_id=statutory_liabilities.company_id and cm.user_id=(select auth.uid())));
create policy "finance manage liabilities" on public.statutory_liabilities for all to authenticated using(exists(select 1 from public.company_members cm where cm.company_id=statutory_liabilities.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','ACCOUNTANT'))) with check(exists(select 1 from public.company_members cm where cm.company_id=statutory_liabilities.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','ACCOUNTANT')));
create policy "members read payments" on public.statutory_payments for select to authenticated using(exists(select 1 from public.company_members cm where cm.company_id=statutory_payments.company_id and cm.user_id=(select auth.uid())));
create policy "finance manage payments" on public.statutory_payments for all to authenticated using(exists(select 1 from public.company_members cm where cm.company_id=statutory_payments.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','ACCOUNTANT'))) with check(exists(select 1 from public.company_members cm where cm.company_id=statutory_payments.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','ACCOUNTANT')));
create policy "members read compliance audit" on public.compliance_audit_logs for select to authenticated using(exists(select 1 from public.company_members cm where cm.company_id=compliance_audit_logs.company_id and cm.user_id=(select auth.uid())));
insert into storage.buckets(id,name,public) values('compliance','compliance',false) on conflict(id) do nothing;
create policy "members read compliance files" on storage.objects for select to authenticated using(bucket_id='compliance' and exists(select 1 from public.company_members cm where cm.company_id::text=(storage.foldername(name))[2] and cm.user_id=(select auth.uid())));
