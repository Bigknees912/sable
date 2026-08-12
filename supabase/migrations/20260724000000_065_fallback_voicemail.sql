-- Task 1: voicemail fallback behind the AI receptionist.
--
-- When Vapi or the receptionist webhook is unreachable/erroring, the call
-- is routed (at the Vapi phone-number level - see receptionist-server
-- README "Outage safety net") to a recorded voicemail. That voicemail is
-- POSTed to the `fallback-voicemail` edge function, which lands it here as
-- a real New Lead, flagged so it's never confused with a normal
-- AI-handled call.

-- Flag on the customer so the CRM/dispatch board can clearly mark a lead
-- that came in through the fallback path rather than a live AI call or a
-- manual add. Nullable text (not an enum) so adding future capture methods
-- never needs a constraint migration.
alter table public.customers add column if not exists capture_method text;

-- Allow 'voicemail' as a calls.outcome. The original constraint predates
-- tracked migrations and its name isn't known here, so drop whatever check
-- constraint currently governs calls.outcome and recreate it with the full
-- set plus 'voicemail'. Idempotent.
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public' and rel.relname = 'calls'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%outcome%'
  loop
    execute format('alter table public.calls drop constraint %I', c.conname);
  end loop;

  alter table public.calls
    add constraint calls_outcome_check
    check (outcome in ('abandoned','quoted','booked','transferred','voicemail'));
end $$;

comment on column public.customers.capture_method is
  'How this lead first reached us: null/normal (AI call or manual), or ''fallback_voicemail'' when captured by the outage voicemail fallback. See supabase/functions/fallback-voicemail.';
