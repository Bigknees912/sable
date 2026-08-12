-- Phase 1 live technician location: one row per tech, upserted by the
-- tech's own browser while they have a job in progress and the app open.
-- src/lib/jobs.js already queried a `tech_locations` table before any
-- migration defined it (it returned empty because nothing populated it), so
-- this migration is written defensively: create-if-not-exists plus
-- add-column-if-not-exists, then (re)declare RLS from scratch, so it
-- reconciles whether or not an ad-hoc version of the table already exists.

create table if not exists public.tech_locations (
  tech_id uuid primary key references auth.users(id) on delete cascade
);

alter table public.tech_locations add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.tech_locations add column if not exists job_id uuid references public.jobs(id) on delete set null;
alter table public.tech_locations add column if not exists lat double precision;
alter table public.tech_locations add column if not exists lng double precision;
alter table public.tech_locations add column if not exists accuracy double precision; -- meters, from the Geolocation API
alter table public.tech_locations add column if not exists updated_at timestamptz not null default now();

create index if not exists tech_locations_company_idx on public.tech_locations (company_id);

alter table public.tech_locations enable row level security;

-- A technician may create/update ONLY their own row, and only stamped with
-- their own company. company_id is derived server-side from the caller's
-- profile (current_company_id()), so a tech can't plant a pin in someone
-- else's company even if they tamper with the client payload.
drop policy if exists tech_locations_upsert_own on public.tech_locations;
create policy tech_locations_upsert_own on public.tech_locations
  for insert to authenticated
  with check (tech_id = auth.uid() and company_id = public.current_company_id());

drop policy if exists tech_locations_update_own on public.tech_locations;
create policy tech_locations_update_own on public.tech_locations
  for update to authenticated
  using (tech_id = auth.uid() and company_id = public.current_company_id())
  with check (tech_id = auth.uid() and company_id = public.current_company_id());

-- Reads are deliberately narrow for privacy: an owner or office admin can see
-- their whole crew, and a technician can see only their own row. A tech can
-- never see a coworker's live position.
drop policy if exists tech_locations_select_scoped on public.tech_locations;
create policy tech_locations_select_scoped on public.tech_locations
  for select to authenticated
  using (
    company_id = public.current_company_id()
    and ("current_role"() in ('owner', 'office_admin') or tech_id = auth.uid())
  );

-- A tech can stop sharing by deleting their own row; owners/office admins can
-- clear a stale pin for their company.
drop policy if exists tech_locations_delete_scoped on public.tech_locations;
create policy tech_locations_delete_scoped on public.tech_locations
  for delete to authenticated
  using (
    tech_id = auth.uid()
    or (company_id = public.current_company_id() and "current_role"() in ('owner', 'office_admin'))
  );
