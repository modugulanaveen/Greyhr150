-- Store the company's default tax regime alongside its existing payroll settings.
alter table public.payroll_settings
  add column if not exists default_tax_regime text not null default 'NEW'
  check (default_tax_regime in ('NEW', 'OLD'));