-- WF10 reads companies_with_billing then reads/writes seat_nudge_sent, but the
-- view never exposed it: its column list came from migration 074, which
-- predates the three jsonb columns migration 075 added, and 076 carried that
-- stale list forward when it recreated the view to drop join_code. Net effect:
-- WF10's seat nudge could not tell whether a nudge had already fired, so it
-- silently did nothing.
--
-- Appended at the end rather than placed with the other companies columns:
-- CREATE OR REPLACE VIEW can only add columns to the tail, and appending avoids
-- dropping a view three workflows read. join_code stays out (migration 076).
create or replace view public.companies_with_billing
with (security_invoker = true) as
select c.id, c.name, c.trade, c.team_size_bracket, c.service_area, c.timezone,
       c.base_fee, c.hourly_rate, c.sameday_multiplier, c.emergency_multiplier,
       c.deposit_threshold, c.deposit_pct, c.commission_pct, c.auto_assign_by_zone,
       c.notify_emergency_calls, c.created_at, c.google_review_link, c.status,
       c.contact_email, c.financing_enabled, c.financing_threshold,
       c.financing_partner_url, c.goal_type, c.goal_target, c.callback_window_days,
       c.owner_slack_channel, c.service_area_lat, c.service_area_lng, c.cancelled_at,
       c.owner_phone,
       s.stripe_customer_id, s.stripe_subscription_id, s.plan,
       s.status as subscription_status,
       c.payment_failure_log, c.usage_drop_alert_log, c.seat_nudge_sent
  from public.companies c
  left join public.subscriptions s on s.company_id = c.id;
