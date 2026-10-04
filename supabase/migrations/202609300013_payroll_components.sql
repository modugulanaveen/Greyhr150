-- Payroll component catalog and adjustment snapshots. Existing adjustment rows remain valid.
create table public.payroll_components (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 80),
  direction text not null check (direction in ('EARNING','DEDUCTION')),
  is_taxable boolean not null default true,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,name,direction)
);
create index payroll_components_company_idx on public.payroll_components(company_id,direction,active);
create trigger payroll_components_updated_at before update on public.payroll_components for each row execute function public.touch_updated_at();
alter table public.payroll_components enable row level security;
create policy "members read payroll components" on public.payroll_components for select to authenticated using (
  exists(select 1 from public.company_members cm where cm.company_id=payroll_components.company_id and cm.user_id=(select auth.uid()))
);
create policy "admins manage payroll components" on public.payroll_components for all to authenticated using (
  exists(select 1 from public.company_members cm where cm.company_id=payroll_components.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR'))
) with check (
  exists(select 1 from public.company_members cm where cm.company_id=payroll_components.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR'))
);
alter table public.payroll_adjustments
  add column component_id uuid references public.payroll_components(id) on delete set null,
  add column component_name text,
  add column component_type text check (component_type is null or component_type in ('EARNING','DEDUCTION')),
  add column component_taxable boolean;
create index payroll_adjustments_component_idx on public.payroll_adjustments(component_id);
