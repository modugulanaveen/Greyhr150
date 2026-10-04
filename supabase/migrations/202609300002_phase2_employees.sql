-- PayMate Phase 2: employee management. Append-only; never modify Phase 1 migration.
create extension if not exists pgcrypto;

alter table public.company_members drop constraint if exists company_members_role_check;
alter table public.company_members add constraint company_members_role_check check (role in ('OWNER','COMPANY_ADMIN','HR','ACCOUNTANT'));

create table public.departments (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 name text not null check (char_length(trim(name)) between 1 and 100), code text check (code is null or char_length(trim(code)) between 1 and 30),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,name), unique(company_id,code)
);
create index departments_company_idx on public.departments(company_id);

create table public.employees (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 employee_id text not null check (char_length(trim(employee_id)) between 1 and 50), first_name text not null check (char_length(trim(first_name)) between 1 and 100), last_name text not null check (char_length(trim(last_name)) between 1 and 100),
 email text, mobile text, date_of_birth date, gender text, residential_address text, emergency_contact_name text, emergency_contact_phone text,
 date_of_joining date not null, department_id uuid references public.departments(id) on delete set null, designation text, employment_type text not null default 'FULL_TIME' check (employment_type in ('FULL_TIME','PART_TIME','CONTRACT','INTERN','CONSULTANT')),
 reporting_manager text, employment_status text not null default 'ACTIVE' check (employment_status in ('ACTIVE','INACTIVE','ON_NOTICE','TERMINATED')), last_working_date date, work_location text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deactivated_at timestamptz,
 unique(company_id,employee_id), check(last_working_date is null or last_working_date >= date_of_joining)
);
create index employees_company_idx on public.employees(company_id); create index employees_company_status_idx on public.employees(company_id,employment_status); create index employees_company_joining_idx on public.employees(company_id,date_of_joining); create index employees_search_idx on public.employees using gin(to_tsvector('simple', coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' || coalesce(employee_id,'') || ' ' || coalesce(designation,'')));

create table public.employee_employment_details (
 employee_id uuid primary key references public.employees(id) on delete cascade, company_id uuid not null references public.companies(id) on delete cascade,
 date_of_joining date not null, department_id uuid references public.departments(id) on delete set null, designation text, employment_type text not null default 'FULL_TIME' check (employment_type in ('FULL_TIME','PART_TIME','CONTRACT','INTERN','CONSULTANT')),
 reporting_manager text, employment_status text not null default 'ACTIVE' check (employment_status in ('ACTIVE','INACTIVE','ON_NOTICE','TERMINATED')), last_working_date date, work_location text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index employee_employment_company_idx on public.employee_employment_details(company_id);

create table public.employee_salary_assignments (
 id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employees(id) on delete cascade, company_id uuid not null references public.companies(id) on delete cascade,
 annual_ctc numeric(15,2) check (annual_ctc is null or annual_ctc >= 0), effective_from date not null, payment_frequency text not null default 'MONTHLY' check(payment_frequency in ('MONTHLY','WEEKLY','BIWEEKLY')),
 salary_structure_assignment text, pf_applicable boolean not null default true, pt_applicable boolean not null default true, tds_applicable boolean not null default true,
 created_at timestamptz not null default now(), unique(employee_id,effective_from)
);
create index salary_assignments_employee_effective_idx on public.employee_salary_assignments(employee_id,effective_from desc);

create table public.employee_bank_details (
 employee_id uuid primary key references public.employees(id) on delete cascade, company_id uuid not null references public.companies(id) on delete cascade,
 account_holder_name text, bank_name text, account_number text, ifsc text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.employee_statutory_details (
 employee_id uuid primary key references public.employees(id) on delete cascade, company_id uuid not null references public.companies(id) on delete cascade,
 pan text, uan text, pf_member_id text, aadhaar_reference text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.employee_previous_employment (
 employee_id uuid primary key references public.employees(id) on delete cascade, company_id uuid not null references public.companies(id) on delete cascade,
 employer_name text, taxable_salary numeric(15,2) check(taxable_salary is null or taxable_salary >= 0), tds_deducted numeric(15,2) check(tds_deducted is null or tds_deducted >= 0), employment_start_date date, employment_end_date date,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(employment_end_date is null or employment_start_date is null or employment_end_date >= employment_start_date)
);

create table public.employee_documents (
 id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employees(id) on delete cascade, company_id uuid not null references public.companies(id) on delete cascade,
 document_type text not null check(document_type in ('OFFER_LETTER','PAN_DOCUMENT','BANK_PROOF','FORM_16','FORM_12B','OTHER')),
 original_name text not null, storage_path text not null unique, mime_type text not null, file_size bigint not null check(file_size > 0 and file_size <= 5242880), uploaded_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create index employee_documents_employee_idx on public.employee_documents(employee_id,created_at desc); create index employee_documents_company_idx on public.employee_documents(company_id);

create trigger departments_updated_at before update on public.departments for each row execute function public.touch_updated_at();
create trigger employees_updated_at before update on public.employees for each row execute function public.touch_updated_at();
create trigger employment_details_updated_at before update on public.employee_employment_details for each row execute function public.touch_updated_at();
create trigger bank_details_updated_at before update on public.employee_bank_details for each row execute function public.touch_updated_at();
create trigger statutory_details_updated_at before update on public.employee_statutory_details for each row execute function public.touch_updated_at();
create trigger previous_employment_updated_at before update on public.employee_previous_employment for each row execute function public.touch_updated_at();

alter table public.departments enable row level security; alter table public.employees enable row level security; alter table public.employee_employment_details enable row level security; alter table public.employee_salary_assignments enable row level security; alter table public.employee_bank_details enable row level security; alter table public.employee_statutory_details enable row level security; alter table public.employee_previous_employment enable row level security; alter table public.employee_documents enable row level security;

create policy "members can read departments" on public.departments for select to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=departments.company_id and cm.user_id=(select auth.uid())));
create policy "admins can manage departments" on public.departments for all to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=departments.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR'))) with check (exists(select 1 from public.company_members cm where cm.company_id=departments.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR')));

create policy "members read employees" on public.employees for select to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=employees.company_id and cm.user_id=(select auth.uid())));
create policy "hr manage employees" on public.employees for all to authenticated using (exists(select 1 from public.company_members cm where cm.company_id=employees.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR'))) with check (exists(select 1 from public.company_members cm where cm.company_id=employees.company_id and cm.user_id=(select auth.uid()) and cm.role in ('OWNER','COMPANY_ADMIN','HR')));

-- Detail tables remain protected from direct browser access; API performs role-aware access with service role.
-- This deliberately prevents ACCOUNTANT and ordinary authenticated clients from bypassing API field-level restrictions.

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('employee-documents','employee-documents',false,5242880,array['application/pdf','image/png','image/jpeg','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public=false,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;
