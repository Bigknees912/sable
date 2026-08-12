-- Schema support for the n8n automation suite (WF1-WF7).
--
-- The workflows were authored against an idealised schema that doesn't match
-- this database: they expect a `contacts` table (ours is `customers`), a
-- `scheduled_at` timestamp on jobs (ours is `scheduled_date` + a text
-- `scheduled_window`), and several tables that never existed. The workflow
-- JSON in n8n/workflows/ has been rewritten to use our real table and column
-- names; this migration adds the pieces that genuinely didn't exist yet.
--
-- Deliberately NOT done here: widening jobs.status. The workflows wanted to
-- write 'booked' / 'confirmed' / 'reschedule_requested' into jobs.status,
-- which would break every app view that filters on the real vocabulary
-- (unassigned/assigned/in_progress/done/cancelled). Appointment confirmation
-- is tracked in jobs.confirmation_state instead, so the two never collide.

-- ---------------------------------------------------------------------------
-- companies: owner notification targets + service-area coordinates (WF6)
-- ---------------------------------------------------------------------------
alter table public.companies
  add column if not exists owner_slack_channel text,
  add column if not exists service_area_lat numeric,
  add column if not exists service_area_lng numeric,
  add column if not exists cancelled_at timestamptz;

comment on column public.companies.owner_slack_channel is
  'Slack channel ID for owner alerts (hot leads, negative feedback, weather). Null = fall back to email only.';
comment on column public.companies.service_area_lat is
  'Service-area centroid, used by the weather-staffing workflow (WF6) to pull a forecast.';

-- ---------------------------------------------------------------------------
-- customers: lead attribution + recency, so nurture/reactivation can target
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists source text,
  add column if not exists last_seen_at timestamptz,
  add column if not exists last_job_completed_at timestamptz,
  add column if not exists stripe_customer_id text;

comment on column public.customers.source is
  'Where the lead came from (web_form, phone, referral, ...). Set by WF1 on capture.';
comment on column public.customers.last_job_completed_at is
  'Maintained by trigger from jobs.completed_at; WF5 uses it to find dormant customers.';

create index if not exists customers_dormant_idx
  on public.customers (company_id, last_job_completed_at desc);

-- ---------------------------------------------------------------------------
-- jobs: a real appointment timestamp, plus the automation state flags
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column if not exists scheduled_at timestamptz,
  add column if not exists service_type text,
  add column if not exists confirmation_state text
    check (confirmation_state in ('pending', 'confirmed', 'reschedule_requested')),
  add column if not exists confirmed_at timestamptz,
  add column if not exists tech_dispatched boolean not null default false,
  add column if not exists tech_dispatched_at timestamptz,
  add column if not exists review_requested boolean not null default false,
  add column if not exists review_requested_at timestamptz,
  add column if not exists negative_feedback boolean not null default false,
  add column if not exists negative_feedback_at timestamptz,
  add column if not exists neutral_feedback boolean not null default false;

comment on column public.jobs.scheduled_at is
  'Precise appointment start. scheduled_date + scheduled_window stay authoritative for the UI; this is what SMS reminders format against.';
comment on column public.jobs.confirmation_state is
  'Customer reply to the pre-appointment SMS. Separate from jobs.status so confirmations never overwrite dispatch state.';

create index if not exists jobs_scheduled_at_idx
  on public.jobs (company_id, scheduled_at)
  where scheduled_at is not null;

-- Keep jobs.service_type readable without a join - the workflows send it
-- straight into SMS/email copy.
create or replace function public.sync_job_service_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.job_type_id is not null then
    select label into new.service_type from public.job_types where id = new.job_type_id;
  end if;
  return new;
end;
$$;

drop trigger if exists job_service_type_sync on public.jobs;
create trigger job_service_type_sync
  before insert or update of job_type_id on public.jobs
  for each row execute function public.sync_job_service_type();

update public.jobs j
   set service_type = t.label
  from public.job_types t
 where j.job_type_id = t.id
   and j.service_type is distinct from t.label;

-- Recency for the reactivation campaign.
create or replace function public.sync_customer_last_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.completed_at is not null and new.customer_id is not null then
    update public.customers
       set last_job_completed_at = greatest(coalesce(last_job_completed_at, new.completed_at), new.completed_at)
     where id = new.customer_id;
  end if;
  return new;
end;
$$;

drop trigger if exists customer_last_job_sync on public.jobs;
create trigger customer_last_job_sync
  after insert or update of completed_at on public.jobs
  for each row execute function public.sync_customer_last_job();

-- ---------------------------------------------------------------------------
-- confirmation_requests (WF2 / WF2b): outbound confirmation SMS + the reply
-- ---------------------------------------------------------------------------
create table if not exists public.confirmation_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  customer_phone text not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'reschedule_requested', 'expired')),
  sent_at timestamptz not null default now(),
  responded_at timestamptz
);

-- WF2b matches an inbound SMS to the newest pending request for that number.
create index if not exists confirmation_requests_lookup_idx
  on public.confirmation_requests (customer_phone, status, sent_at desc);
create index if not exists confirmation_requests_job_idx
  on public.confirmation_requests (job_id);

-- One live request per job: re-running the daily workflow must not spam.
create unique index if not exists confirmation_requests_one_pending_per_job
  on public.confirmation_requests (job_id)
  where status = 'pending';

alter table public.confirmation_requests enable row level security;

create policy confirmation_requests_company_select on public.confirmation_requests
  for select using (company_id = public.current_company_id());

-- ---------------------------------------------------------------------------
-- tasks (WF3b): owner follow-up queue, currently only negative-feedback callbacks
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  type text not null default 'callback'
    check (type in ('callback', 'follow_up', 'other')),
  title text not null,
  description text,
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high')),
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'done', 'dismissed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists tasks_open_idx
  on public.tasks (company_id, status, priority, created_at desc);

alter table public.tasks enable row level security;

create policy tasks_company_select on public.tasks
  for select using (company_id = public.current_company_id());

create policy tasks_company_update on public.tasks
  for update using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- ---------------------------------------------------------------------------
-- nurture_log (WF5): one row per nurture touch, so a customer can't be
-- enrolled twice and the owner can see what was sent
-- ---------------------------------------------------------------------------
create table if not exists public.nurture_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_id uuid references public.customers(id) on delete cascade,
  entry_reason text,
  message_number integer,
  status text not null default 'sent'
    check (status in ('sent', 'stopped', 'no_contact_method')),
  sent_at timestamptz not null default now()
);

create index if not exists nurture_log_contact_idx
  on public.nurture_log (contact_id, sent_at desc);

alter table public.nurture_log enable row level security;

create policy nurture_log_company_select on public.nurture_log
  for select using (company_id = public.current_company_id());

-- ---------------------------------------------------------------------------
-- companies_with_billing (WF7): Stripe events arrive keyed by customer id,
-- which lives on subscriptions, not companies. Read-only join so the billing
-- workflow can resolve a company in one lookup.
-- ---------------------------------------------------------------------------
create or replace view public.companies_with_billing
with (security_invoker = true) as
select c.*,
       s.stripe_customer_id,
       s.stripe_subscription_id,
       s.plan,
       s.status as subscription_status
  from public.companies c
  left join public.subscriptions s on s.company_id = c.id;
