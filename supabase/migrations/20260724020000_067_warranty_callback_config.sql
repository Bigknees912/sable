-- Task 3: warranty callback tracking — configurable window + owner review.
--
-- Builds on migration 064 (is_callback / original_job_id / callback_waived
-- and the tech_callback_rates view). Two additions:
--   1. A per-company, owner-editable window (Settings) for how recently a
--      completed job of the same type counts as a warranty callback.
--   2. A flag so a detected callback is routed to the owner for a manual
--      decision (shown on the dispatch board as "possible warranty
--      callback") instead of silently becoming a normal paid job.

alter table public.companies
  add column if not exists callback_window_days integer not null default 30;

alter table public.jobs
  add column if not exists callback_needs_review boolean not null default false;

comment on column public.companies.callback_window_days is
  'How many days a completed job of the same type counts as a possible warranty callback for a returning caller. Owner-editable in Settings. Default 30.';
comment on column public.jobs.callback_needs_review is
  'True when the AI detected a possible warranty callback and routed it to the owner for a manual charge decision rather than auto-booking it as paid work.';
