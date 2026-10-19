-- ═══════════════════════════════════════════════════════════
--  ZOVER PRIVILEGE — database setup
--  Paste this whole file into Supabase → SQL Editor → Run
--  Safe to run more than once.
-- ═══════════════════════════════════════════════════════════

create extension if not exists pgcrypto with schema extensions;

-- ─────────────── TABLES ───────────────

create table if not exists public.residents (
  id            uuid primary key default gen_random_uuid(),
  first_name    text not null,
  last_name     text not null,
  phone         text not null unique,
  password_hash text not null,
  district      text not null,
  building      text not null,
  apt           text not null,
  contract_url  text,
  created_at    timestamptz not null default now()
);

create table if not exists public.partners (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  category    text not null,
  logo        text,
  icon        text,
  discount    text,
  description text,
  terms       text,
  how_to      text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.vouchers (
  id          uuid primary key default gen_random_uuid(),
  resident_id uuid not null references public.residents(id) on delete cascade,
  partner_id  uuid not null references public.partners(id)  on delete cascade,
  code        text not null,
  created_at  timestamptz not null default now(),
  unique (resident_id, partner_id)
);

create table if not exists public.app_config (
  key   text primary key,
  value text not null
);

-- Admin password: a PLACEHOLDER is seeded here (do not keep it).
-- Set the real admin password separately — never commit it to this public repo:
--   update public.app_config
--     set value = extensions.crypt('YOUR_REAL_PASSWORD', extensions.gen_salt('bf'))
--     where key = 'admin_password_hash';
-- The ON CONFLICT below means re-running this file never overwrites an existing password.
insert into public.app_config(key, value)
values ('admin_password_hash', extensions.crypt('CHANGE_ME_SET_A_REAL_PASSWORD', extensions.gen_salt('bf')))
on conflict (key) do nothing;

-- ─────────────── SECURITY ───────────────
-- Everything is locked by default. The browser can only reach
-- data through the named functions below.

alter table public.residents  enable row level security;
alter table public.partners   enable row level security;
alter table public.vouchers   enable row level security;
alter table public.app_config enable row level security;

drop policy if exists "partners are public" on public.partners;
create policy "partners are public"
  on public.partners for select using (true);

-- ─────────────── ADMIN CHECK ───────────────

create or replace function public.admin_ok(p_password text)
returns boolean
language sql security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.app_config
    where key = 'admin_password_hash'
      and value = extensions.crypt(p_password, value)
  );
$$;

-- ─────────────── RESIDENTS ───────────────

create or replace function public.phone_exists(p_phone text)
returns boolean
language sql security definer set search_path = public as $$
  select exists (select 1 from public.residents where phone = p_phone);
$$;

create or replace function public.register_resident(
  p_first text, p_last text, p_phone text, p_password text,
  p_district text, p_building text, p_apt text,
  p_contract_url text default null
)
returns public.residents
language plpgsql security definer set search_path = public, extensions as $$
declare r public.residents;
begin
  insert into public.residents
    (first_name, last_name, phone, password_hash, district, building, apt, contract_url)
  values
    (p_first, p_last, p_phone,
     extensions.crypt(p_password, extensions.gen_salt('bf')),
     p_district, p_building, p_apt, p_contract_url)
  returning * into r;
  r.password_hash := null;
  return r;
end $$;

create or replace function public.login_resident(p_phone text, p_password text)
returns public.residents
language plpgsql security definer set search_path = public, extensions as $$
declare r public.residents;
begin
  select * into r from public.residents where phone = p_phone;
  if r.id is null then return null; end if;
  if r.password_hash <> extensions.crypt(p_password, r.password_hash) then
    return null;
  end if;
  r.password_hash := null;
  return r;
end $$;

create or replace function public.reset_password(p_phone text, p_password text)
returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  update public.residents
     set password_hash = extensions.crypt(p_password, extensions.gen_salt('bf'))
   where phone = p_phone;
  return found;
end $$;

-- ─────────────── VOUCHERS ───────────────

create or replace function public.get_or_create_voucher(
  p_resident uuid, p_partner uuid
)
returns public.vouchers
language plpgsql security definer set search_path = public as $$
declare v public.vouchers; res public.residents; prt public.partners;
begin
  select * into v from public.vouchers
   where resident_id = p_resident and partner_id = p_partner;
  if v.id is not null then return v; end if;

  select * into res from public.residents where id = p_resident;
  select * into prt from public.partners  where id = p_partner;
  if res.id is null or prt.id is null then return null; end if;

  insert into public.vouchers (resident_id, partner_id, code)
  values (p_resident, p_partner,
          'Z' || coalesce(trim(res.building),'') || coalesce(trim(res.apt),'')
              || upper(left(coalesce(trim(prt.name),'X'), 1)))
  returning * into v;
  return v;
end $$;

create or replace function public.list_vouchers(p_resident uuid)
returns table (
  partner_id uuid, code text, partner_name text,
  discount text, logo text, icon text, category text
)
language sql security definer set search_path = public as $$
  select v.partner_id, v.code, p.name, p.discount, p.logo, p.icon, p.category
    from public.vouchers v
    join public.partners p on p.id = v.partner_id
   where v.resident_id = p_resident
   order by v.created_at desc;
$$;

-- ─────────────── ADMIN ───────────────

create or replace function public.admin_list_residents(p_password text)
returns table (
  id uuid, first_name text, last_name text, phone text,
  district text, building text, apt text,
  contract_url text, created_at timestamptz, voucher_count bigint
)
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_ok(p_password) then
    raise exception 'unauthorized';
  end if;
  return query
    select r.id, r.first_name, r.last_name, r.phone, r.district,
           r.building, r.apt, r.contract_url, r.created_at,
           (select count(*) from public.vouchers v where v.resident_id = r.id)
      from public.residents r
     order by r.created_at desc;
end $$;

create or replace function public.admin_list_vouchers(p_password text, p_resident uuid)
returns table (partner_id uuid, code text, partner_name text, discount text,
               logo text, icon text, category text)
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_ok(p_password) then
    raise exception 'unauthorized';
  end if;
  return query select * from public.list_vouchers(p_resident);
end $$;

create or replace function public.admin_save_partner(
  p_password text, p_id uuid, p_name text, p_category text,
  p_logo text, p_icon text, p_discount text,
  p_description text, p_terms text, p_how_to text
)
returns public.partners
language plpgsql security definer set search_path = public as $$
declare p public.partners;
begin
  if not public.admin_ok(p_password) then
    raise exception 'unauthorized';
  end if;

  if p_id is null then
    insert into public.partners
      (name, category, logo, icon, discount, description, terms, how_to)
    values
      (p_name, p_category, p_logo, p_icon, p_discount, p_description, p_terms, p_how_to)
    returning * into p;
  else
    update public.partners
       set name = p_name, category = p_category, logo = p_logo, icon = p_icon,
           discount = p_discount, description = p_description,
           terms = p_terms, how_to = p_how_to
     where id = p_id
    returning * into p;
  end if;
  return p;
end $$;

create or replace function public.admin_set_partner_active(
  p_password text, p_id uuid, p_active boolean
)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_ok(p_password) then
    raise exception 'unauthorized';
  end if;
  update public.partners set active = p_active where id = p_id;
  return found;
end $$;

create or replace function public.admin_stats(p_password text)
returns table (residents bigint, vouchers bigint, partners bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_ok(p_password) then
    raise exception 'unauthorized';
  end if;
  return query select
    (select count(*) from public.residents),
    (select count(*) from public.vouchers),
    (select count(*) from public.partners);
end $$;

-- ═══════════════════════════════════════════════════════════
--  Done. You should see "Success. No rows returned".
-- ═══════════════════════════════════════════════════════════
