-- PayMate Phase 1: append-only migration; future phases must add new timestamped migrations.
create extension if not exists pgcrypto;
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  legal_name text not null check (char_length(trim(legal_name)) between 2 and 200),
  country char(2) not null default 'IN' check (country = 'IN'),
  state text check (state is null or char_length(state) <= 100),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.company_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('OWNER','COMPANY_ADMIN','HR')),
  created_at timestamptz not null default now(),
  primary key (company_id,user_id)
);
create index company_members_user_idx on public.company_members(user_id);
create index company_members_company_idx on public.company_members(company_id);
create function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
create trigger companies_updated_at before update on public.companies for each row execute function public.touch_updated_at();
-- Tenant isolation applies to browser (anon/authenticated) and future non-service-role access.
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
create policy "members read own memberships" on public.company_members for select to authenticated using (user_id = (select auth.uid()));
create policy "members read their companies" on public.companies for select to authenticated using (
  exists (select 1 from public.company_members cm where cm.company_id = companies.id and cm.user_id = (select auth.uid()))
);
-- No direct client inserts/updates/deletes; company creation is through authenticated backend only.
-- Atomic RPC uses service-role privileges; validate user ID in Express via auth.getUser(token) first.
create function public.create_company_for_user(p_user_id uuid, p_name text, p_legal_name text, p_country char(2), p_state text default null)
returns public.companies language plpgsql security definer set search_path = '' as $$
declare result public.companies;
begin
  if p_user_id is null or not exists(select 1 from auth.users where id = p_user_id) then raise exception 'Invalid user'; end if;
  if p_country <> 'IN' then raise exception 'Unsupported country'; end if;
  insert into public.companies(name,legal_name,country,state) values (p_name,p_legal_name,p_country,p_state) returning * into result;
  insert into public.company_members(company_id,user_id,role) values(result.id,p_user_id,'OWNER');
  return result;
end; $$;
revoke all on function public.create_company_for_user(uuid,text,text,char(2),text) from public, anon, authenticated;
grant execute on function public.create_company_for_user(uuid,text,text,char(2),text) to service_role;
