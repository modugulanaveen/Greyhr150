-- Match workbook first-month TDS configuration and signed whole-rupee LOP reconciliation.
alter table public.tax_settings
  add column first_month_tds_paid_day_factor numeric(5,4) not null default 1
  check (first_month_tds_paid_day_factor between 0 and 1);

