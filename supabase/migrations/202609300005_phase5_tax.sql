-- PayMate Phase 5: configurable Indian income-tax/TDS estimation. Additive only.
create table public.tax_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  financial_year text not null check(financial_year ~ '^20[0-9]{2}-[0-9]{2}$'),
  regime text not null check(regime in ('NEW','OLD')),
  standard_deduction numeric(15,2) not null default 75000 check(standard_deduction >= 0),
  cess_rate numeric(6,3) not null default 4 check(cess_rate between 0 and 100),
  marginal_relief_enabled boolean not null default true,
  marginal_relief_income_limit numeric(15,2),
  first_month_tds_method text not null default 'PRORATED_REDISTRIBUTE' check(first_month_tds_method in ('FULL_MONTHLY','PRORATED_REDISTRIBUTE')),
  rounding_method text not null default 'WHOLE_RUPEE' check(rounding_method='WHOLE_RUPEE'),
  final_month_adjustment_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, financial_year, regime)
);
create table public.tax_slabs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  financial_year text not null,
  regime text not null check(regime in ('NEW','OLD')),
  lower_limit numeric(15,2) not null check(lower_limit >= 0),
  upper_limit numeric(15,2),
  rate numeric(6,3) not null check(rate between 0 and 100),
  created_at timestamptz not null default now(),
  constraint tax_slab_limits check(upper_limit is null or upper_limit > lower_limit)
);
create table public.tax_rebates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  financial_year text not null,
  regime text not null check(regime in ('NEW','OLD')),
  income_limit numeric(15,2) not null check(income_limit >= 0),
  maximum_rebate numeric(15,2) not null check(maximum_rebate >= 0),
  created_at timestamptz not null default now(),
  unique(company_id, financial_year, regime)
);
create table public.employee_tax_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  financial_year text not null,
  tax_regime text not null check(tax_regime in ('NEW','OLD')),
  previous_employer_taxable_salary numeric(15,2) not null default 0 check(previous_employer_taxable_salary >= 0),
  previous_employer_tds numeric(15,2) not null default 0 check(previous_employer_tds >= 0),
  other_taxable_income numeric(15,2) not null default 0 check(other_taxable_income >= 0),
  other_tds numeric(15,2) not null default 0 check(other_tds >= 0),
  tax_declaration_status text not null default 'PENDING' check(tax_declaration_status in ('PENDING','SUBMITTED','VERIFIED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, employee_id, financial_year)
);
create table public.tds_calculations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  financial_year text not null,
  taxable_income numeric(15,2) not null default 0 check(taxable_income >= 0),
  tax_before_rebate numeric(15,2) not null default 0 check(tax_before_rebate >= 0),
  rebate numeric(15,2) not null default 0 check(rebate >= 0),
  marginal_relief numeric(15,2) not null default 0 check(marginal_relief >= 0),
  tax_after_rebate numeric(15,2) not null default 0 check(tax_after_rebate >= 0),
  cess numeric(15,2) not null default 0 check(cess >= 0),
  annual_tax numeric(15,2) not null default 0 check(annual_tax >= 0),
  previous_tds numeric(15,2) not null default 0 check(previous_tds >= 0),
  remaining_tds numeric(15,2) not null default 0 check(remaining_tds >= 0),
  calculation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, employee_id, financial_year)
);
create table public.tds_monthly_schedule (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  financial_year text not null,
  payroll_month integer not null check(payroll_month between 1 and 12),
  projected_income numeric(15,2) not null default 0 check(projected_income >= 0),
  tds_amount numeric(15,2) not null default 0 check(tds_amount >= 0),
  deferred_amount numeric(15,2) not null default 0 check(deferred_amount >= 0),
  cumulative_tds numeric(15,2) not null default 0 check(cumulative_tds >= 0),
  created_at timestamptz not null default now(),
  unique(company_id, employee_id, financial_year, payroll_month)
);

create index tax_slabs_lookup_idx on public.tax_slabs(company_id, financial_year, regime, lower_limit);
create index employee_tax_profiles_employee_idx on public.employee_tax_profiles(company_id, employee_id, financial_year);
create index tds_calculations_company_idx on public.tds_calculations(company_id, financial_year);
create index tds_schedule_company_idx on public.tds_monthly_schedule(company_id, financial_year, payroll_month);

create or replace function public.tax_employee_same_company() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.employees e where e.id = new.employee_id and e.company_id = new.company_id) then raise exception 'Employee does not belong to company'; end if;
  return new;
end; $$;
create trigger employee_tax_profiles_company before insert or update on public.employee_tax_profiles for each row execute function public.tax_employee_same_company();
create trigger tds_calculations_company before insert or update on public.tds_calculations for each row execute function public.tax_employee_same_company();
create trigger tds_schedule_company before insert or update on public.tds_monthly_schedule for each row execute function public.tax_employee_same_company();
create trigger tax_settings_updated_at before update on public.tax_settings for each row execute function public.touch_updated_at();
create trigger employee_tax_profiles_updated_at before update on public.employee_tax_profiles for each row execute function public.touch_updated_at();
create trigger tds_calculations_updated_at before update on public.tds_calculations for each row execute function public.touch_updated_at();

alter table public.tax_settings enable row level security;
alter table public.tax_slabs enable row level security;
alter table public.tax_rebates enable row level security;
alter table public.employee_tax_profiles enable row level security;
alter table public.tds_calculations enable row level security;
alter table public.tds_monthly_schedule enable row level security;

create policy "members read tax settings" on public.tax_settings for select to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=tax_settings.company_id and cm.user_id=(select auth.uid())));
create policy "admins manage tax settings" on public.tax_settings for all to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=tax_settings.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN'))) with check (exists(select 1 from public.company_members cm where cm.company_id=tax_settings.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN')));
create policy "members read tax slabs" on public.tax_slabs for select to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=tax_slabs.company_id and cm.user_id=(select auth.uid())));
create policy "admins manage tax slabs" on public.tax_slabs for all to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=tax_slabs.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN'))) with check (exists(select 1 from public.company_members cm where cm.company_id=tax_slabs.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN')));
create policy "members read tax rebates" on public.tax_rebates for select to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=tax_rebates.company_id and cm.user_id=(select auth.uid())));
create policy "admins manage tax rebates" on public.tax_rebates for all to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=tax_rebates.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN'))) with check (exists(select 1 from public.company_members cm where cm.company_id=tax_rebates.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN')));
create policy "members read employee tax profiles" on public.employee_tax_profiles for select to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=employee_tax_profiles.company_id and cm.user_id=(select auth.uid())));
create policy "hr manage employee tax profiles" on public.employee_tax_profiles for all to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=employee_tax_profiles.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR','ACCOUNTANT'))) with check (exists(select 1 from public.company_members cm where cm.company_id=employee_tax_profiles.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR','ACCOUNTANT')));
create policy "members read tds calculations" on public.tds_calculations for select to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=tds_calculations.company_id and cm.user_id=(select auth.uid())));
create policy "hr manage tds calculations" on public.tds_calculations for all to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=tds_calculations.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR','ACCOUNTANT'))) with check (exists(select 1 from public.company_members cm where cm.company_id=tds_calculations.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR','ACCOUNTANT')));
create policy "members read tds schedule" on public.tds_monthly_schedule for select to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=tds_monthly_schedule.company_id and cm.user_id=(select auth.uid())));
create policy "hr manage tds schedule" on public.tds_monthly_schedule for all to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=tds_monthly_schedule.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR','ACCOUNTANT'))) with check (exists(select 1 from public.company_members cm where cm.company_id=tds_monthly_schedule.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR','ACCOUNTANT')));

-- Initial configurable reference tax rules. Administrators must verify/update these against the applicable Finance Act before relying on payroll output.
do $$
declare c record; fy text; regime text; sd numeric; cess numeric; rebate_limit numeric; rebate_max numeric;
begin
  for c in select id from public.companies loop
    for fy in select unnest(array['2025-26','2026-27']) loop
      for regime in select unnest(array['NEW','OLD']) loop
        if regime='NEW' then sd:=75000; rebate_limit:=1200000; rebate_max:=60000;
        else sd:=50000; rebate_limit:=500000; rebate_max:=12500; end if;
        insert into public.tax_settings(company_id,financial_year,regime,standard_deduction,cess_rate,marginal_relief_enabled,marginal_relief_income_limit)
          values(c.id,fy,regime,sd,4,true,rebate_limit) on conflict(company_id,financial_year,regime) do nothing;
        if regime='NEW' then
          insert into public.tax_slabs(company_id,financial_year,regime,lower_limit,upper_limit,rate) values
            (c.id,fy,regime,0,400000,0),(c.id,fy,regime,400000,800000,5),(c.id,fy,regime,800000,1200000,10),(c.id,fy,regime,1200000,1600000,15),(c.id,fy,regime,1600000,2000000,20),(c.id,fy,regime,2000000,2400000,25),(c.id,fy,regime,2400000,null,30);
        else
          insert into public.tax_slabs(company_id,financial_year,regime,lower_limit,upper_limit,rate) values
            (c.id,fy,regime,0,250000,0),(c.id,fy,regime,250000,500000,5),(c.id,fy,regime,500000,1000000,20),(c.id,fy,regime,1000000,null,30);
        end if;
        insert into public.tax_rebates(company_id,financial_year,regime,income_limit,maximum_rebate) values(c.id,fy,regime,rebate_limit,rebate_max) on conflict(company_id,financial_year,regime) do nothing;
      end loop;
    end loop;
  end loop;
end $$;

create or replace function public.seed_tax_defaults_for_company() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.tax_settings(company_id,financial_year,regime,standard_deduction,cess_rate,marginal_relief_enabled,marginal_relief_income_limit)
    values(new.id,'2026-27','NEW',75000,4,true,1200000), (new.id,'2026-27','OLD',50000,4,true,500000)
    on conflict(company_id,financial_year,regime) do nothing;
  insert into public.tax_slabs(company_id,financial_year,regime,lower_limit,upper_limit,rate) values
    (new.id,'2026-27','NEW',0,400000,0),(new.id,'2026-27','NEW',400000,800000,5),(new.id,'2026-27','NEW',800000,1200000,10),(new.id,'2026-27','NEW',1200000,1600000,15),(new.id,'2026-27','NEW',1600000,2000000,20),(new.id,'2026-27','NEW',2000000,2400000,25),(new.id,'2026-27','NEW',2400000,null,30),
    (new.id,'2026-27','OLD',0,250000,0),(new.id,'2026-27','OLD',250000,500000,5),(new.id,'2026-27','OLD',500000,1000000,20),(new.id,'2026-27','OLD',1000000,null,30);
  insert into public.tax_rebates(company_id,financial_year,regime,income_limit,maximum_rebate) values(new.id,'2026-27','NEW',1200000,60000),(new.id,'2026-27','OLD',500000,12500) on conflict(company_id,financial_year,regime) do nothing;
  return new;
end; $$;
create trigger company_tax_defaults after insert on public.companies for each row execute function public.seed_tax_defaults_for_company();
