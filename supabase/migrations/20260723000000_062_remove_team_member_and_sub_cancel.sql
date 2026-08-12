-- Two independent additions, both in service of the "confirmation dialogs
-- before destructive actions" pass:
--
-- 1. Removing a team member had NO backend at all before this - no RPC, no
--    way to revoke a tech's access short of a database edit. This adds it:
--    an owner can null out a profile's company_id (which is exactly what
--    current_company_id() reads for RLS everywhere), unassigning their
--    open jobs at the same time. The auth.users row itself is left alone -
--    deleting/banning it needs the service-role key, which the browser
--    never has - so "removed" means "no longer has access to this
--    company's data", not "account destroyed". A removed tech signing back
--    in just lands with no company and nothing to see.
--
-- 2. cancel_at_period_end lets Settings show "your plan ends on <date>"
--    and the self-serve cancel-subscription edge function (and the
--    existing stripe-webhook sync) both write into the same column.

create or replace function public.owner_remove_team_member(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_caller_company uuid := public.current_company_id();
  v_target record;
begin
  if v_caller_company is null or "current_role"() != 'owner' then
    raise exception 'only an owner can remove a team member';
  end if;

  select id, company_id, role into v_target from public.profiles where id = p_profile_id;
  if v_target is null then
    raise exception 'profile not found';
  end if;
  if v_target.company_id is distinct from v_caller_company then
    raise exception 'that person is not on your team';
  end if;
  if v_target.role = 'owner' then
    raise exception 'the owner account cannot be removed';
  end if;
  if v_target.id = auth.uid() then
    raise exception 'you cannot remove yourself';
  end if;

  update public.jobs set assigned_tech_id = null where assigned_tech_id = p_profile_id and company_id = v_caller_company;
  update public.profiles set company_id = null, location_id = null where id = p_profile_id;
end;
$$;

revoke all on function public.owner_remove_team_member(uuid) from public, anon;
grant execute on function public.owner_remove_team_member(uuid) to authenticated;

alter table public.subscriptions add column if not exists cancel_at_period_end boolean not null default false;
