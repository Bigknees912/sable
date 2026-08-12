-- A customer calling back about the same job within 30 days shouldn't be
-- charged again for the same problem - that's just fair, and an owner
-- would rather have that waived automatically and consistently than left
-- to whoever happens to answer the phone remembering the history. Tagging
-- it also means callback jobs are queryable by original tech, which
-- surfaces a real quality signal (a tech with a high callback rate has a
-- workmanship problem) without anyone having to notice it by hand.
alter table public.jobs add column if not exists is_callback boolean not null default false;
alter table public.jobs add column if not exists original_job_id uuid references public.jobs(id) on delete set null;
alter table public.jobs add column if not exists callback_waived boolean not null default false;

create index if not exists jobs_original_job_id_idx on public.jobs (original_job_id) where original_job_id is not null;

-- Per-tech callback rate, scoped by the underlying jobs RLS policy via
-- security_invoker so an owner only ever sees their own company's techs -
-- no separate grant/policy needed on the view itself.
create or replace view public.tech_callback_rates
with (security_invoker = true) as
select
  j.company_id,
  j.assigned_tech_id as tech_id,
  p.name as tech_name,
  count(*) filter (where j.status = 'done') as completed_jobs,
  count(*) filter (where j.is_callback) as callback_jobs
from public.jobs j
join public.profiles p on p.id = j.assigned_tech_id
where j.assigned_tech_id is not null
group by j.company_id, j.assigned_tech_id, p.name;
