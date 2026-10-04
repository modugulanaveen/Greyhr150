-- Keep issued payslips readable while a reopened payroll is recalculated.
-- Backfill each payslip's payroll row before allowing its live FK to be cleared.
update public.payslips p
set snapshot = coalesce(p.snapshot, '{}'::jsonb) || jsonb_build_object(
  'payroll_record', to_jsonb(r),
  'adjustments', coalesce((
    select jsonb_agg(to_jsonb(a) order by a.created_at, a.id)
    from public.payroll_adjustments a
    where a.company_id = p.company_id
      and a.payroll_run_id = p.payroll_run_id
      and a.employee_id = p.employee_id
  ), '[]'::jsonb)
)
from public.payroll_records r
where p.payroll_record_id = r.id
  and (not (coalesce(p.snapshot, '{}'::jsonb) ? 'payroll_record')
    or not (coalesce(p.snapshot, '{}'::jsonb) ? 'adjustments'));

alter table public.payslips
  drop constraint if exists payslips_payroll_record_id_fkey;
alter table public.payslips
  alter column payroll_record_id drop not null;
alter table public.payslips
  add constraint payslips_payroll_record_id_fkey
  foreign key (payroll_record_id) references public.payroll_records(id) on delete set null;

create or replace function public.payslip_employee_company_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare emp_company uuid; run_company uuid; record_company uuid;
begin
  select company_id into emp_company from public.employees where id = new.employee_id;
  select company_id into run_company from public.payroll_runs where id = new.payroll_run_id;
  if new.payroll_record_id is not null then
    select company_id into record_company from public.payroll_records where id = new.payroll_record_id;
  end if;
  if emp_company is null or emp_company <> new.company_id
    or run_company is null or run_company <> new.company_id
    or (new.payroll_record_id is not null and (record_company is null or record_company <> new.company_id)) then
    raise exception 'Payslip company mismatch';
  end if;
  return new;
end; $$;
