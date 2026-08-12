-- Support for WF8a/WF8b (7-day dunning), WF9 (usage-drop alert) and WF10
-- (seat-limit upsell).

-- ---------------------------------------------------------------------------
-- companies: three JSON audit/suppression logs the workflows read-modify-write
-- ---------------------------------------------------------------------------
alter table public.companies
  add column if not exists payment_failure_log jsonb not null default '[]'::jsonb,
  add column if not exists usage_drop_alert_log jsonb,
  add column if not exists seat_nudge_sent jsonb not null default '{}'::jsonb;

comment on column public.companies.payment_failure_log is
  'Append-only dunning history: initial_failure, retry_failed, 3ds_required, retry_success, suspended.';
comment on column public.companies.usage_drop_alert_log is
  'Last usage-drop alert {last_alerted_week, last_alerted_drop, alert_sent_at}; suppresses repeat alerts within 14 days.';
comment on column public.companies.seat_nudge_sent is
  'Which seat-limit upsell nudges have fired, keyed <plan>_<threshold>, so an owner is nudged once per tier.';

-- ---------------------------------------------------------------------------
-- payment_retry_queue (WF8a / WF8b): the dunning state machine
-- ---------------------------------------------------------------------------
create table if not exists public.payment_retry_queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  invoice_id text not null,
  customer_email text,
  amount_due integer not null default 0,     -- cents, straight from Stripe
  attempt_number integer not null default 1,
  status text not null default 'pending'
    check (status in ('pending', 'resolved_paid', 'suspended',
                      'error-no-company', 'error-stale')),
  email_sent boolean not null default false,
  next_retry_at timestamptz,
  created_at timestamptz not null default now()
);

-- WF8b guards on "is this invoice already queued?" - make that guarantee real
-- at the database rather than trusting a race-prone lookup.
create unique index if not exists payment_retry_queue_invoice_uniq
  on public.payment_retry_queue (invoice_id);

-- The poller's hot query: pending rows whose retry time has arrived.
create index if not exists payment_retry_queue_due_idx
  on public.payment_retry_queue (status, next_retry_at)
  where status = 'pending';

alter table public.payment_retry_queue enable row level security;

-- Billing dunning is platform business, not tenant-readable.
drop policy if exists payment_retry_queue_super_admin on public.payment_retry_queue;
create policy payment_retry_queue_super_admin on public.payment_retry_queue
  for all using (public.is_super_admin()) with check (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- usage_weekly (WF9): weekly call + job counts per company.
--
-- A view, not a table: there is nothing to populate and it can never drift
-- from the underlying calls/jobs rows. Weeks with activity on only one side
-- still appear, with zero on the other.
-- ---------------------------------------------------------------------------
create or replace view public.usage_weekly
with (security_invoker = true) as
select coalesce(c.company_id, j.company_id)  as company_id,
       coalesce(c.week_start, j.week_start)  as week_start,
       coalesce(c.call_count, 0)             as call_count,
       coalesce(j.job_count, 0)              as job_count
  from (select company_id,
               (date_trunc('week', started_at))::date as week_start,
               count(*)::int as call_count
          from public.calls
         where started_at is not null
         group by 1, 2) c
  full join (select company_id,
                    (date_trunc('week', created_at))::date as week_start,
                    count(*)::int as job_count
               from public.jobs
              group by 1, 2) j
    on j.company_id = c.company_id
   and j.week_start = c.week_start;

comment on view public.usage_weekly is
  'Per-company weekly call/job counts derived from calls.started_at and jobs.created_at. Read by the usage-drop alert (WF9).';
