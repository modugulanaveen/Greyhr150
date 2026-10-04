-- PayMate Phase 3: salary structures and configurable payroll settings. Additive only.
create table public.payroll_settings (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null unique references public.companies(id) on delete cascade,
 currency char(3) not null default 'INR' check(currency='INR'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.pf_settings (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null unique references public.companies(id) on delete cascade,
 enabled boolean not null default true,
 employee_pf_rate numeric(6,3) not null default 12 check(employee_pf_rate between 0 and 100),
 employer_pf_rate numeric(6,3) not null default 12 check(employer_pf_rate between 0 and 100),
 pf_wage_ceiling numeric(15,2) not null default 25000 check(pf_wage_ceiling >= 0),
 minimum_basic numeric(15,2) not null default 20000 check(minimum_basic >= 0),
 basic_percentage numeric(6,3) not null default 50 check(basic_percentage between 0 and 100),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.pt_settings (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null unique references public.companies(id) on delete cascade,
 enabled boolean not null default false,
 state text,
 slabs jsonb not null default '[]'::jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint pt_slabs_array check(jsonb_typeof(slabs)='array')
);
create table public.salary_structures (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 employee_id uuid not null,
 annual_ctc numeric(15,2) not null check(annual_ctc > 0),
 monthly_ctc numeric(15,2) not null check(monthly_ctc >= 0),
 basic_salary numeric(15,2) not null check(basic_salary >= 0),
 special_allowance numeric(15,2) not null default 0 check(special_allowance >= 0),
 gross_salary numeric(15,2) not null check(gross_salary >= 0),
 employee_pf numeric(15,2) not null default 0 check(employee_pf >= 0),
 employer_pf numeric(15,2) not null default 0 check(employer_pf >= 0),
 professional_tax numeric(15,2) not null default 0 check(professional_tax >= 0),
 effective_from date not null,
 effective_to date,
 status text not null default 'ACTIVE' check(status in ('ACTIVE','CLOSED','INACTIVE')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint salary_dates_valid check(effective_to is null or effective_to >= effective_from),
 constraint salary_employee_company_fk foreign key(employee_id) references public.employees(id) on delete restrict
);
create index salary_structures_company_idx on public.salary_structures(company_id);
create index salary_structures_employee_effective_idx on public.salary_structures(employee_id,effective_from desc);
create unique index salary_structures_active_employee_idx on public.salary_structures(employee_id) where status='ACTIVE';
create trigger payroll_settings_updated_at before update on public.payroll_settings for each row execute function public.touch_updated_at();
create trigger pf_settings_updated_at before update on public.pf_settings for each row execute function public.touch_updated_at();
create trigger pt_settings_updated_at before update on public.pt_settings for each row execute function public.touch_updated_at();
create trigger salary_structures_updated_at before update on public.salary_structures for each row execute function public.touch_updated_at();

alter table public.payroll_settings enable row level security;
alter table public.pf_settings enable row level security;
alter table public.pt_settings enable row level security;
alter table public.salary_structures enable row level security;

create policy "members read payroll settings" on public.payroll_settings for select to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=payroll_settings.company_id and cm.user_id=(select auth.uid())));
create policy "admins manage payroll settings" on public.payroll_settings for all to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=payroll_settings.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR'))) with check (exists(select 1 from public.company_members cm where cm.company_id=payroll_settings.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR')));
create policy "members read pf settings" on public.pf_settings for select to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=pf_settings.company_id and cm.user_id=(select auth.uid())));
create policy "admins manage pf settings" on public.pf_settings for all to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=pf_settings.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR'))) with check (exists(select 1 from public.company_members cm where cm.company_id=pf_settings.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR')));
create policy "members read pt settings" on public.pt_settings for select to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=pt_settings.company_id and cm.user_id=(select auth.uid())));
create policy "admins manage pt settings" on public.pt_settings for all to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=pt_settings.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR'))) with check (exists(select 1 from public.company_members cm where cm.company_id=pt_settings.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR')));
create policy "members read salary structures" on public.salary_structures for select to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=salary_structures.company_id and cm.user_id=(select auth.uid())));
create policy "admins manage salary structures" on public.salary_structures for all to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=salary_structures.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR'))) with check (exists(select 1 from public.company_members cm where cm.company_id=salary_structures.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR')));
