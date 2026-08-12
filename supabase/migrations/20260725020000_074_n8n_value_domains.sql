-- Reconcile the value vocabularies the n8n workflows write with our CHECK
-- constraints. Without this, three workflows fail at the database on their
-- first real run rather than at import time, which is the worst place to
-- find out.

-- WF7 texts the owner when a trial is ending or a payment failed; there was
-- nowhere to store an owner mobile number.
alter table public.companies
  add column if not exists owner_phone text;

comment on column public.companies.owner_phone is
  'Owner mobile (E.164) for billing-lifecycle SMS. Null = email/Slack only.';

-- WF7 marks a company payment_failed on invoice.payment_failed. The existing
-- constraint only allowed trial/active/suspended/cancelled, so that write
-- would have raised a check violation and left the company looking healthy.
alter table public.companies drop constraint if exists companies_status_check;
alter table public.companies add constraint companies_status_check
  check (status in ('trial', 'active', 'payment_failed', 'suspended', 'cancelled'));

-- WF5 logs 'stopped_booked' (customer booked, campaign halted) and
-- 'no_contact_info' (no phone and no email). Accept the workflow's own
-- vocabulary rather than rewriting it in nine places.
alter table public.nurture_log drop constraint if exists nurture_log_status_check;
alter table public.nurture_log add constraint nurture_log_status_check
  check (status in ('sent', 'stopped', 'stopped_booked', 'no_contact_method', 'no_contact_info'));

-- c.* is expanded at creation time, so the billing view has to be rebuilt to
-- pick up owner_phone.
drop view if exists public.companies_with_billing;
create view public.companies_with_billing
with (security_invoker = true) as
select c.*,
       s.stripe_customer_id,
       s.stripe_subscription_id,
       s.plan,
       s.status as subscription_status
  from public.companies c
  left join public.subscriptions s on s.company_id = c.id;
