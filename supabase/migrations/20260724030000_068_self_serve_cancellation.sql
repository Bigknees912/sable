-- Task 4: easy, self-serve cancellation + a distinct admin status.
--
-- The cancel flow itself already exists (cancel-subscription edge function
-- + subscriptions.cancel_at_period_end, migrations 062/063-era). This adds:
--   1. An optional "reason for leaving" captured at cancel time (for the
--      operator's own records - never a mandatory retention gate).
--   2. A super-admin-only RPC exposing which active companies are actually
--      cancelling (cancel_at_period_end) so the panel can show
--      "Cancelling" as its own status, distinct from a card-failure
--      "Suspended". current_period_end tells the operator when it lapses.

alter table public.subscriptions add column if not exists cancellation_reason text;
alter table public.subscriptions add column if not exists cancellation_requested_at timestamptz;

comment on column public.subscriptions.cancellation_reason is
  'Optional free-text reason the owner gave when self-cancelling. For operator records only - the cancel flow never requires it.';

-- Lightweight companion to admin_list_companies: returns just the
-- cancellation signal per company so the super-admin panel can label a
-- chosen-to-leave account differently from a non-payment suspension,
-- without having to rewrite the larger listing RPC. Super-admin gated,
-- same as every other admin_* function (see AUTH.md "Super-admin panel").
create or replace function public.admin_company_cancellations()
returns table (
  company_id uuid,
  cancel_at_period_end boolean,
  cancellation_reason text,
  cancellation_requested_at timestamptz,
  current_period_end timestamptz
)
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not public.is_super_admin() then
    raise exception 'not authorized';
  end if;
  return query
    select s.company_id, s.cancel_at_period_end, s.cancellation_reason,
           s.cancellation_requested_at, s.current_period_end
    from public.subscriptions s
    where s.cancel_at_period_end = true;
end;
$$;

grant execute on function public.admin_company_cancellations() to authenticated;
