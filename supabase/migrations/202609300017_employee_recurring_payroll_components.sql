create table public.employee_recurring_payroll_components (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  component_id uuid not null references public.payroll_components(id) on delete restrict,
  amount numeric(15,2) not null check (amount > 0),
  reason text not null,
  notes text,
  starts_month date not null,
  ends_month date,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_month is null or ends_month >= starts_month)
);

create index employee_recurring_components_period_idx
  on public.employee_recurring_payroll_components(company_id, starts_month, ends_month, active);
create index employee_recurring_components_employee_idx
  on public.employee_recurring_payroll_components(company_id, employee_id, active);
create trigger employee_recurring_components_updated_at
  before update on public.employee_recurring_payroll_components
  for each row execute function public.touch_updated_at();
create or replace function public.recurring_component_company_check()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from public.employees e
    where e.id = new.employee_id and e.company_id = new.company_id
  ) then
    raise exception 'Employee does not belong to company';
  end if;
  if not exists (
    select 1 from public.payroll_components pc
    where pc.id = new.component_id and pc.company_id = new.company_id
  ) then
    raise exception 'Payroll component does not belong to company';
  end if;
  return new;
end; $$;
create trigger employee_recurring_components_company_check
  before insert or update on public.employee_recurring_payroll_components
  for each row execute function public.recurring_component_company_check();

alter table public.employee_recurring_payroll_components enable row level security;
create policy "members read recurring payroll components"
  on public.employee_recurring_payroll_components for select to authenticated
  using (exists (
    select 1 from public.company_members cm
    where cm.company_id = employee_recurring_payroll_components.company_id
      and cm.user_id = (select auth.uid())
  ));
create policy "payroll admins manage recurring payroll components"
  on public.employee_recurring_payroll_components for all to authenticated
  using (exists (
    select 1 from public.company_members cm
    where cm.company_id = employee_recurring_payroll_components.company_id
      and cm.user_id = (select auth.uid())
      and cm.role in ('OWNER', 'COMPANY_ADMIN', 'HR', 'ACCOUNTANT')
  ))
  with check (exists (
    select 1 from public.company_members cm
    where cm.company_id = employee_recurring_payroll_components.company_id
      and cm.user_id = (select auth.uid())
      and cm.role in ('OWNER', 'COMPANY_ADMIN', 'HR', 'ACCOUNTANT')
  ));

alter table public.payroll_adjustments
  add column recurring_component_id uuid
    references public.employee_recurring_payroll_components(id) on delete set null,
  add column voided boolean not null default false;

create unique index payroll_adjustments_recurring_instance_idx
  on public.payroll_adjustments(payroll_run_id, recurring_component_id)
  where recurring_component_id is not null;
