-- Task 2: no-login customer portal.
--
-- Every job gets a long, random, non-guessable token. The booking
-- confirmation text includes a link (portal.html?t=<token>) that opens a
-- read-only status page for that ONE job - no account, no password. The
-- token is the credential, so it must be unguessable (24 random bytes =
-- 48 hex chars, ~192 bits) and never a sequential id. The public
-- `job-status` edge function only ever returns the single job matching an
-- exact token, so guessing one token can never surface another customer's
-- job. See supabase/functions/job-status and portal.html.

create extension if not exists pgcrypto with schema extensions;

alter table public.jobs
  add column if not exists portal_token text
  default encode(extensions.gen_random_bytes(24), 'hex');

-- Backfill any pre-existing rows that predate the column.
update public.jobs
  set portal_token = encode(extensions.gen_random_bytes(24), 'hex')
  where portal_token is null;

alter table public.jobs alter column portal_token set not null;

create unique index if not exists jobs_portal_token_key on public.jobs (portal_token);

comment on column public.jobs.portal_token is
  'Unguessable per-job token for the no-login customer portal (portal.html). Treat like a password: the job-status edge function returns only the single job with an exactly-matching token.';
