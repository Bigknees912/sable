-- Audit fix C1: the app/DB plan rows drifted from what the marketing site
-- and the founder brief actually sell. Marketing (pricing.html, homepage,
-- get-started) and CLAUDE.md both define three PAID tiers:
--   Solo  $399/mo  - 1 technician seat
--   Team  $699/mo  - up to 5 technician seats
--   Fleet $999/mo  - unlimited seats
-- The app read plan name/price/seat_limit straight from this table, so a
-- prospect sold "Solo $399" was landing on a free "starter". This realigns
-- the rows to the marketing truth. Internal keys (starter/growth/pro) are
-- left unchanged so RLS policies, migration 056's 'pro'=Fleet gating, and
-- the STRIPE_PRICE_* env mapping keep working - only the customer-facing
-- name/price/seat_limit change.
--
-- Note: there is intentionally no free tier anymore (the brief has none).
-- Onboarding already routes any plan with monthly_price > 0 through Stripe
-- Checkout (planRequiresCheckout), so making all three paid means every new
-- signup goes through checkout with the 7-day trial (see the updated
-- create-subscription-checkout). Any pre-existing company still on the old
-- free 'starter' keeps access; it simply now displays as Solo and would be
-- asked to add billing on its next plan action.

update public.plans set name = 'Solo',  monthly_price = 399, seat_limit = 1    where key = 'starter';
update public.plans set name = 'Team',  monthly_price = 699, seat_limit = 5    where key = 'growth';
update public.plans set name = 'Fleet', monthly_price = 999, seat_limit = null where key = 'pro';
