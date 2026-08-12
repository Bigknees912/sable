-- Stage 1 auth/multi-tenancy hardening.
--
-- Scope note: an audit recommended ten Stage 1 items. Six were already
-- satisfied and are deliberately NOT re-done here:
--   * RLS is on for every public table (pg_tables audit returns none)
--   * every INSERT/UPDATE policy already has WITH CHECK
--   * service_role appears nowhere in src/, *.html, or built dist/
--   * create_company_and_owner is already one transactional SECURITY DEFINER
--     RPC, so there is no orphaned-auth-user window
--   * supabase/tests/rls_isolation.test.sql already proves cross-tenant
--     isolation (reads, writes, FK hardening) and rolls back
--   * all 42 SECURITY DEFINER functions already set search_path explicitly
--     (=public). The hijack attack needs an *unset* search_path plus CREATE
--     on an earlier schema; authenticated has neither. Rewriting 42 bodies
--     to fully-qualify every call for search_path='' is churn, not security.
--
-- This migration covers the four that were genuinely open.

-- ---------------------------------------------------------------------------
-- 1. Trigger functions must not be callable as RPCs
--
-- PostgREST exposes every function in `public` at /rest/v1/rpc/<name>, and the
-- Supabase advisor flags these fourteen as reachable by anon/authenticated.
-- They are trigger bodies: invoked directly they reference an unassigned NEW/
-- OLD record, so the practical risk is low, but there is no reason for them to
-- be on the public API surface at all.
--
-- Safe because a trigger fires with the privileges of the table owner, not the
-- caller, so revoking EXECUTE from client roles does not stop them firing.
--
-- The RLS helpers (current_company_id, current_role, is_super_admin) are
-- deliberately left executable: a policy expression is evaluated as the
-- querying user, so revoking EXECUTE would make every policy that calls them
-- fail with "permission denied for function". They also leak nothing -- each
-- returns a fact about the caller they already know. Hiding them properly
-- means moving them to a non-exposed schema, which requires recreating every
-- policy that references them; that is its own change, not a one-liner.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'cancel_review_on_negative_feedback', 'enqueue_customer_automations',
    'enqueue_job_status_automations', 'notify_deposit_paid',
    'notify_invoice_paid', 'notify_job_assigned', 'notify_job_started',
    'notify_negative_feedback', 'prevent_role_tampering',
    'sync_customer_last_job', 'sync_job_service_type', 'validate_call_customer',
    'validate_job_location', 'validate_profile_location'
  ] loop
    execute format('revoke all on function public.%I() from public, anon, authenticated', fn);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Join-code lifecycle: expiring, capped, revocable
--
-- Migration 076 moved the code somewhere only owners can read it. It was still
-- a permanent, unlimited-use credential.
--
-- Defaults preserve today's product model on purpose. Sable's code is one per
-- company, read aloud or texted to the whole crew, so max_uses stays NULL
-- (unlimited) -- forcing single-use would mean regenerating per technician,
-- which is a product decision, not a security fix. What does change: a code
-- now expires 30 days out, because a shared credential that lives forever is
-- the actual exposure. Owners regenerate from the team page.
-- ---------------------------------------------------------------------------
alter table public.company_join_codes
  add column if not exists expires_at timestamptz not null default (now() + interval '30 days'),
  add column if not exists max_uses   integer,
  add column if not exists uses       integer not null default 0,
  add column if not exists is_active  boolean not null default true;

comment on column public.company_join_codes.expires_at is
  'Codes expire 30 days after issue/regeneration. Redemption checks this in the same transaction that increments uses.';
comment on column public.company_join_codes.max_uses is
  'NULL = unlimited, matching the shared-crew-code model. Set to 1 for a single-use invite.';

-- ---------------------------------------------------------------------------
-- 3. Brute-force throttle: NOT SHIPPED -- it cannot work as designed
--
-- Migration 058 added a join_code_attempts counter and was never applied. It
-- was written here, applied, tested, and removed again, because PostgREST runs
-- each RPC in a single transaction: the RAISE that rejects a bad code rolls
-- back the very `insert into join_code_attempts` meant to record that failure.
-- Measured against the live project: ten bad guesses produced one logged
-- attempt. A counter that cannot count failures is worse than none, because it
-- reads as a control that exists.
--
-- Making it real needs one of:
--   (a) an autonomous transaction (dblink) so the attempt row commits
--       independently of the rolled-back outer transaction;
--   (b) changing join_company to return NULL instead of raising on a bad code,
--       so the insert commits -- costs the distinct expired/revoked/used-up
--       messages and touches auth.js + EmployeeJoinScreen, both of which
--       string-match on the thrown error today;
--   (c) throttling above the database, in the app or an edge function.
--
-- Deferred pending that choice. Note the code is 8 hex chars (XXXX-XXXX), so
-- online guessing is not the near-term risk that expiry and revocation are.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 4. join_company: validate the code's lifecycle, then consume it
--
-- SELECT ... FOR UPDATE serialises concurrent redemptions, so two techs racing
-- on a max_uses=1 code cannot both get in. The uses increment happens in the
-- same transaction as the profile insert: either both land or neither does.
-- ---------------------------------------------------------------------------
create or replace function public.join_company(p_join_code text, p_name text, p_role text default 'tech')
returns public.companies
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company public.companies;
  v_code public.company_join_codes;
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


  select * into v_code from public.company_join_codes
   where code = upper(trim(p_join_code))
   for update;   -- serialise concurrent redemptions

  if v_code.company_id is null then
    raise exception 'invalid join code';
  end if;

  -- Distinct messages for expired/revoked: you already had to hold the code to
  -- get here, so this leaks nothing a guesser could use, and "that code has
  -- expired" is far more actionable than a flat "wrong code".
  if not v_code.is_active then
    raise exception 'join_code_revoked: that code has been turned off. Ask your boss for a new one.';
  end if;
  if v_code.expires_at <= now() then
    raise exception 'join_code_expired: that code has expired. Ask your boss for a new one.';
  end if;
  if v_code.max_uses is not null and v_code.uses >= v_code.max_uses then
    raise exception 'join_code_used_up: that code has already been used. Ask your boss for a new one.';
  end if;

  select * into v_company from public.companies where id = v_code.company_id;

  -- Seat limit is re-checked here, at redemption, not just at code creation.
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

  -- Consume the code in the same transaction as the profile insert.
  update public.company_join_codes
     set uses = uses + 1, updated_at = now()
   where company_id = v_company.id;

  return v_company;
end;
$function$;

-- regenerate_join_code: a fresh code resets the whole lifecycle.
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
  on conflict (company_id) do update
    set code       = excluded.code,
        expires_at = now() + interval '30 days',
        uses       = 0,
        is_active  = true,
        updated_at = now();

  return v_code;
end;
$function$;

-- Explicit revoke, so an owner can kill a code they read out to the wrong
-- person without having to issue a replacement first.
create or replace function public.revoke_join_code()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if public.current_role() <> 'owner' then
    raise exception 'only an owner can turn off the join code';
  end if;
  update public.company_join_codes
     set is_active = false, updated_at = now()
   where company_id = public.current_company_id();
end;
$function$;

revoke all on function public.revoke_join_code() from public, anon;
grant execute on function public.revoke_join_code() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Missing tenant-key indexes
--
-- Every RLS policy on these filters company_id, so without an index each check
-- is a sequential scan. All three were added late (migrations 072/075) and
-- missed the index the older tenant tables all have.
-- ---------------------------------------------------------------------------
create index if not exists confirmation_requests_company_id_idx on public.confirmation_requests (company_id);
create index if not exists nurture_log_company_id_idx           on public.nurture_log (company_id);
create index if not exists payment_retry_queue_company_id_idx   on public.payment_retry_queue (company_id);
