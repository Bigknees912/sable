-- Audit trail for the receptionist outage circuit breaker (see
-- receptionist-server/lib/outageAlert.js). Every time the server detects a
-- cluster of tool-call failures for a company and texts the owner, it
-- records one row here - lets an owner (or us) see "yes, Alex really did
-- have trouble on Tuesday at 3pm" instead of just trusting an SMS that may
-- have gotten lost. Written by the receptionist-outage-alert edge function
-- under the service role, so no insert policy is needed for end users.
create table if not exists public.receptionist_outage_alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  failure_count integer not null,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists receptionist_outage_alerts_company_idx on public.receptionist_outage_alerts (company_id, created_at desc);

alter table public.receptionist_outage_alerts enable row level security;

create policy receptionist_outage_alerts_owner_select on public.receptionist_outage_alerts
  for select
  using (company_id = public.current_company_id());
