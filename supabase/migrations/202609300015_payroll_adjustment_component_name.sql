-- Payslip generation reads the adjustment label saved when payroll was calculated.
-- Keep this idempotent so existing deployments missing only this column can upgrade.
alter table public.payroll_adjustments
  add column if not exists component_name text;
