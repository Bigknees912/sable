-- Stop techs from reading their employer's join code.
--
-- Phase 1 requires "techs cannot read join codes". They could: the code lived
-- in companies.join_code, and companies_select is USING (id =
-- current_company_id()) with no column restriction, so any company member --
-- tech and office_admin included -- could `select join_code from companies`
-- and hand out access to the company. companies_with_billing leaked it a
-- second way (it selects c.join_code and is security_invoker, so it inherits
-- the caller's companies RLS).
--
-- Why not a column-level REVOKE: Postgres tracks table-level and column-level
-- SELECT separately, and Supabase's default privileges grant table-wide SELECT
-- on public.companies to authenticated. `revoke select (join_code)` does not
-- override that grant, so the only way to make column privileges work would be
-- to revoke table SELECT and re-grant the other 33 columns individually -- a
-- list that silently rots every time a column is added (three were added in
-- migration 075 alone). Column privileges are also per Postgres role, and every
-- app user is `authenticated`, so they cannot tell an owner from a tech anyway.
--
-- So the code moves to its own table, where row-level security can express
-- "owner of this company, or super admin". Nothing in the app reads
-- companies.join_code directly (the two admin screens read it out of the
-- SECURITY DEFINER RPCs' JSON, which this migration keeps intact), so there are
-- no client changes.

-- ---------------------------------------------------------------------------
-- company_join_codes: one code per company, owner-readable only
-- ---------------------------------------------------------------------------
create table if not exists public.company_join_codes (
  company_id uuid primary key references public.companies(id) on delete cascade,
  code       text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.company_join_codes is
  'Per-company technician join code. Split out of companies so RLS can restrict it to owners -- a tech who can read their company row must not be able to read the code that grants access to it.';

insert into public.company_join_codes (company_id, code)
select id, join_code from public.companies
on conflict (company_id) do nothing;

alter table public.company_join_codes enable row level security;

-- Owners and super admins only. Techs and office_admins get zero rows -- not
-- an error, just nothing, so a `select *` in app code degrades quietly.
drop policy if exists company_join_codes_select_owner on public.company_join_codes;
create policy company_join_codes_select_owner on public.company_join_codes
  for select using (
    public.is_super_admin()
    or (company_id = public.current_company_id() and public.current_role() = 'owner')
  );

-- No insert/update/delete policies on purpose: every write goes through the
-- SECURITY DEFINER functions below, same pattern profiles already uses.

-- ---------------------------------------------------------------------------
-- companies_with_billing: recreate without join_code
--
-- The view named c.join_code explicitly, so it both blocks the column drop and
-- leaked the code to any tech who queried the view. Column list is otherwise
-- byte-for-byte what migration 074 created.
-- ---------------------------------------------------------------------------
drop view if exists public.companies_with_billing;
create view public.companies_with_billing
with (security_invoker = true) as
select c.id,
       c.name,
       c.trade,
       c.team_size_bracket,
       c.service_area,
       c.timezone,
       c.base_fee,
       c.hourly_rate,
       c.sameday_multiplier,
       c.emergency_multiplier,
       c.deposit_threshold,
       c.deposit_pct,
       c.commission_pct,
       c.auto_assign_by_zone,
       c.notify_emergency_calls,
       c.created_at,
       c.google_review_link,
       c.status,
       c.contact_email,
       c.financing_enabled,
       c.financing_threshold,
       c.financing_partner_url,
       c.goal_type,
       c.goal_target,
       c.callback_window_days,
       c.owner_slack_channel,
       c.service_area_lat,
       c.service_area_lng,
       c.cancelled_at,
       c.owner_phone,
       s.stripe_customer_id,
       s.stripe_subscription_id,
       s.plan,
       s.status as subscription_status
  from public.companies c
  left join public.subscriptions s on s.company_id = c.id;

comment on view public.companies_with_billing is
  'companies joined to subscriptions so Stripe-keyed lookups work (stripe_customer_id is not on companies). Deliberately excludes join_code -- see migration 076.';

-- ---------------------------------------------------------------------------
-- Drop the leaking column
-- ---------------------------------------------------------------------------
alter table public.companies drop column if exists join_code;

-- ---------------------------------------------------------------------------
-- Functions that touched companies.join_code.
--
-- All are SECURITY DEFINER, so they read/write company_join_codes regardless of
-- the caller's RLS. Bodies are otherwise unchanged from what was deployed.
-- ---------------------------------------------------------------------------

-- join_company: look the code up in the new table. Everything else (auth
-- check, duplicate-profile guard, role whitelist, seat limit, first-user-
-- becomes-owner) is exactly as deployed.
create or replace function public.join_company(p_join_code text, p_name text, p_role text default 'tech')
returns public.companies
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company public.companies;
  v_role text;
  v_seat_limit integer;
  v_current_seats integer;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'profile already exists for this user';
  end if;
  if p_role not in ('tech', 'office_admin') then
    raise exception 'invalid role: must be tech or office_admin';
  end if;

  select c.* into v_company
  from public.companies c
  join public.company_join_codes j on j.company_id = c.id
  where j.code = upper(trim(p_join_code));

  if v_company.id is null then
    raise exception 'invalid join code';
  end if;

  select p.seat_limit into v_seat_limit
  from public.subscriptions s
  join public.plans p on p.key = s.plan
  where s.company_id = v_company.id;

  if v_seat_limit is not null then
    select count(*) into v_current_seats from public.profiles where company_id = v_company.id;
    if v_current_seats >= v_seat_limit then
      raise exception 'seat_limit_reached: this company''s plan allows up to % team members', v_seat_limit;
    end if;
  end if;

  v_role := case when exists (select 1 from public.profiles where company_id = v_company.id and role = 'owner')
    then p_role else 'owner' end;

  insert into public.profiles (id, company_id, role, name, email)
  values (auth.uid(), v_company.id, v_role, p_name, (select email from auth.users where id = auth.uid()));

  return v_company;
end;
$function$;

-- create_company_and_owner: the owner-signup transaction. It generated the
-- code and inserted it into companies; both now target company_join_codes.
-- Everything else (plan validation, profile, subscription, job-type seeding,
-- default review automation) is unchanged.
create or replace function public.create_company_and_owner(p_business_name text, p_owner_name text, p_trade text default 'Plumbing'::text, p_team_size text default null::text, p_service_area text default null::text, p_plan text default 'starter'::text, p_google_review_link text default null::text)
returns public.companies
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company public.companies;
  v_code text;
  v_plan text := coalesce(p_plan, 'starter');
  v_status text;
  v_trade text := coalesce(p_trade, 'Plumbing');
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'profile already exists for this user';
  end if;
  if not exists (select 1 from public.plans where key = v_plan and active) then
    raise exception 'invalid plan: %', v_plan;
  end if;
  v_status := case when v_plan = 'starter' then 'active' else 'incomplete' end;

  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4))
      || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
    exit when not exists (select 1 from public.company_join_codes where code = v_code);
  end loop;

  insert into public.companies (name, trade, team_size_bracket, service_area, google_review_link)
  values (p_business_name, v_trade, p_team_size, p_service_area, nullif(trim(p_google_review_link), ''))
  returning * into v_company;

  insert into public.company_join_codes (company_id, code) values (v_company.id, v_code);

  insert into public.profiles (id, company_id, role, name, email)
  values (auth.uid(), v_company.id, 'owner', p_owner_name, (select email from auth.users where id = auth.uid()));

  insert into public.subscriptions (company_id, plan, status) values (v_company.id, v_plan, v_status);

  insert into public.job_types (company_id, key, label, base_hours, hourly_rate_override, parts_cost)
  select v_company.id, t.key, t.label, t.base_hours, t.hourly_rate, t.parts_cost
  from public.trade_job_type_templates t
  where t.trade = v_trade
  order by t.display_order;

  insert into public.automations (company_id, name, trigger_type, trigger_config, delay_minutes, action_type, action_config)
  values (
    v_company.id,
    'Ask for a Google review',
    'job_status_changed',
    jsonb_build_object('status', 'done'),
    1440,
    'send_sms',
    jsonb_build_object('message', 'Hi {{first_name}}, thanks for choosing {{company_name}}! If you have a minute, a quick Google review helps us a lot: {{review_link}}')
  );

  return v_company;
end;
$function$;

-- regenerate_join_code: write the new table instead of the dropped column.
create or replace function public.regenerate_join_code()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_code text;
  v_company_id uuid;
begin
  if public.current_role() <> 'owner' then
    raise exception 'only an owner can regenerate the join code';
  end if;
  v_company_id := public.current_company_id();

  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4))
      || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
    exit when not exists (select 1 from public.company_join_codes where code = v_code);
  end loop;

  insert into public.company_join_codes (company_id, code)
  values (v_company_id, v_code)
  on conflict (company_id) do update set code = excluded.code, updated_at = now();

  return v_code;
end;
$function$;

-- admin_create_company: seed the code into the new table, and keep returning a
-- `join_code` key so src/admin/CompaniesPage.jsx keeps working unchanged
-- (to_jsonb(v_company) no longer carries it).
create or replace function public.admin_create_company(p_name text, p_contact_email text, p_plan text, p_trade text default 'Plumbing'::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company public.companies;
  v_code text;
  v_trade text := coalesce(p_trade, 'Plumbing');
  v_template record;
  v_inserted integer := 0;
  v_expected integer;
begin
  if not public.is_super_admin() then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.plans where key = p_plan) then
    raise exception 'invalid plan: %', p_plan;
  end if;
  if p_name is null or trim(p_name) = '' then
    raise exception 'business name is required';
  end if;

  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4))
      || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
    exit when not exists (select 1 from public.company_join_codes where code = v_code);
  end loop;

  insert into public.companies (name, trade, status, contact_email)
  values (trim(p_name), v_trade, 'active', nullif(trim(p_contact_email), ''))
  returning * into v_company;

  insert into public.company_join_codes (company_id, code) values (v_company.id, v_code);

  insert into public.subscriptions (company_id, plan, status) values (v_company.id, p_plan, 'active');

  select count(*) into v_expected from public.trade_job_type_templates where trade = v_trade;

  for v_template in
    select key, label, base_hours, hourly_rate, parts_cost
    from public.trade_job_type_templates
    where trade = v_trade
    order by display_order
  loop
    insert into public.job_types (company_id, key, label, base_hours, hourly_rate_override, parts_cost)
    values (v_company.id, v_template.key, v_template.label, v_template.base_hours, v_template.hourly_rate, v_template.parts_cost);
    v_inserted := v_inserted + 1;
  end loop;

  if v_inserted <> v_expected then
    raise exception 'service catalog seeding mismatch for trade %: expected % templates, inserted %', v_trade, v_expected, v_inserted;
  end if;

  perform public.log_admin_action('create_company', 'company', v_company.id::text,
    jsonb_build_object('name', v_company.name, 'plan', p_plan, 'contact_email', p_contact_email));

  return to_jsonb(v_company) || jsonb_build_object('join_code', v_code);
end;
$function$;

-- admin_get_company_detail: same -- re-add join_code to the 'company' object so
-- the admin detail screen keeps rendering it.
create or replace function public.admin_get_company_detail(p_company_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_result jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'company', to_jsonb(c) || jsonb_build_object(
      'join_code', (select j.code from public.company_join_codes j where j.company_id = c.id)
    ),
    'plan', s.plan,
    'subscription_status', s.status,
    'current_period_end', s.current_period_end,
    'override_price', s.override_price,
    'override_note', s.override_note,
    'tech_count', (select count(*) from public.profiles p where p.company_id = c.id),
    'jobs_booked', (select count(*) from public.jobs j where j.company_id = c.id),
    'calls_handled', (select count(*) from public.calls ca where ca.company_id = c.id),
    'deposit_revenue', (select coalesce(sum(j.deposit_amount), 0) from public.jobs j where j.company_id = c.id and j.deposit_status = 'paid')
  )
  into v_result
  from public.companies c
  left join public.subscriptions s on s.company_id = c.id
  where c.id = p_company_id;

  if v_result is null then
    raise exception 'company not found';
  end if;

  return v_result;
end;
$function$;
