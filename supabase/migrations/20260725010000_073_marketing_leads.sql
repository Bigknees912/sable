-- Sable's own inbound funnel (Website Lead Capture + 2-Day Follow-up).
--
-- Named marketing_leads, NOT leads: public.leads already exists and is
-- tenant-scoped (company_id not null) - a customer's own inbound leads. These
-- rows are prospective *Sable* customers who filled in the marketing site
-- form and have no company yet, so there is no company_id to scope by and
-- only super-admins may read them.
create table if not exists public.marketing_leads (
  id uuid primary key default gen_random_uuid(),
  business_name text,
  contact_name text,
  phone text,
  email text,
  trade_type text,
  team_size text,
  pain_point text,
  source text,
  pipeline_stage text not null default 'new_lead'
    check (pipeline_stage in ('new_lead', 'contacted', 'demo_booked', 'won', 'lost')),
  follow_up_sent boolean not null default false,
  follow_up_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists marketing_leads_pipeline_idx
  on public.marketing_leads (pipeline_stage, created_at desc);

alter table public.marketing_leads enable row level security;

-- No tenant may ever read these; the n8n workflow writes under the service
-- role, and only super-admins can review the funnel.
drop policy if exists marketing_leads_super_admin_all on public.marketing_leads;
create policy marketing_leads_super_admin_all on public.marketing_leads
  for all using (public.is_super_admin()) with check (public.is_super_admin());
