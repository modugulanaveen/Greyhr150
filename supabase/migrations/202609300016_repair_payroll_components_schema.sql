-- Repair installations where the payroll component migration was skipped or only partly applied.
create table if not exists public.payroll_components (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 80),
  direction text not null check (direction in ('EARNING', 'DEDUCTION')),
  is_taxable boolean not null default true,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name, direction)
);

create index if not exists payroll_components_company_idx
  on public.payroll_components(company_id, direction, active);
drop trigger if exists payroll_components_updated_at on public.payroll_components;
create trigger payroll_components_updated_at
  before update on public.payroll_components
  for each row execute function public.touch_updated_at();

alter table public.payroll_components enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'payroll_components'
      and policyname = 'members read payroll components'
  ) then
    create policy "members read payroll components"
      on public.payroll_components for select to authenticated
      using (exists (
        select 1 from public.company_members cm
        where cm.company_id = payroll_components.company_id
          and cm.user_id = (select auth.uid())
      ));
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'payroll_components'
      and policyname = 'admins manage payroll components'
  ) then
    create policy "admins manage payroll components"
      on public.payroll_components for all to authenticated
      using (exists (
        select 1 from public.company_members cm
        where cm.company_id = payroll_components.company_id
          and cm.user_id = (select auth.uid())
          and cm.role in ('OWNER', 'COMPANY_ADMIN', 'HR')
      ))
      with check (exists (
        select 1 from public.company_members cm
        where cm.company_id = payroll_components.company_id
          and cm.user_id = (select auth.uid())
          and cm.role in ('OWNER', 'COMPANY_ADMIN', 'HR')
      ));
  end if;
end $$;

alter table public.payroll_adjustments
  add column if not exists component_id uuid
    references public.payroll_components(id) on delete set null,
  add column if not exists component_name text,
  add column if not exists component_type text
    check (component_type is null or component_type in ('EARNING', 'DEDUCTION')),
  add column if not exists component_taxable boolean;

create index if not exists payroll_adjustments_component_idx
  on public.payroll_adjustments(component_id);
