# n8n automation suite

Ten workflows, version-controlled here so the n8n instance isn't the only
copy. The JSON in `workflows/` has been **rewritten to match this database** —
do not re-import the originals, they were written against an idealised schema
and every one of them would fail at runtime. See "What was changed" below.

Instance: `https://runsable.app.n8n.cloud`

| File | Trigger | What it does |
|---|---|---|
| `wf0-website-lead-capture.json` | Form | Sable's own marketing funnel → `marketing_leads`, owner email, 2-day follow-up |
| `wf1-new-lead-capture.json` | `POST /webhook/sable-new-lead` | Upsert customer, hot-lead alert on emergency |
| `wf2-preappointment-confirmation.json` | Daily 08:00 MDT | Tomorrow's jobs → confirmation SMS + `confirmation_requests` |
| `wf2b-sms-reply-handler.json` | Twilio inbound SMS | YES / RESCHEDULE → `jobs.confirmation_state` |
| `wf3-job-completion-invoice-review.json` | `POST /webhook/sable-job-complete` | Stripe invoice, then review SMS after 2h |
| `wf3b-feedback-handler.json` | `POST /webhook/sable-feedback` | Routes by sentiment; negative → `tasks` callback + owner alert |
| `wf4-tech-on-the-way.json` | `POST /webhook/sable-tech-otw` | "Tech is on the way" SMS with map link |
| `wf5-nurture-reactivation.json` | `POST /webhook/sable-nurture-campaign` + daily 06:00 MDT | 3-touch nurture, stops if they book |
| `wf6-weather-staffing-alert.json` | Daily 05:00 MDT | Open-Meteo forecast → staffing alert at ≥25% precip |
| `wf7-billing-lifecycle.json` | Stripe events | Trial ending, payment failed, cancelled |

## Overlap with the in-app automations

These workflows cover ground the Supabase edge functions already cover. Two of
the three are resolved in this copy; one is still yours to decide.

| Overlap | In-app (Supabase) | n8n | Status |
|---|---|---|---|
| Review request | `send-review-request` + `automation_runs` + the migration-070 trigger that cancels reviews on negative feedback | WF3's review tail | **Resolved.** WF3's review branch (wait 2h → recheck feedback → review SMS) is removed; its invoice branch is kept. The in-app path wins because it already suppresses reviews after negative feedback. |
| "On the way" SMS | `send-on-the-way-sms` edge function | WF4 | **Still yours to pick.** Both send the same text. The edge function also includes the customer portal link; WF4 includes a live map pin. Running both double-texts every customer — disable one before activating WF4. |
| Subscription events | `stripe-webhook` (writes `subscriptions`) | WF7 (writes `companies.status`) | **Safe to run both.** They both fire on `customer.subscription.deleted` but write different tables, so they complement rather than fight. WF7 adds the churn alert. |

This is the "n8n double-send" item from the system audit.

## Credentials to create in n8n

- **Supabase** — project URL + **service role** key. The workflows write
  across tenants, so they bypass RLS by design. Keep this credential to the
  n8n instance only.
- **Twilio** — same account/token/number as the Supabase edge functions.
- **Stripe** — same secret key.
- **Slack** (optional) — only used when `companies.owner_slack_channel` is set.
- **Resend** — an n8n **Header Auth** credential *named exactly `Resend`*,
  with name `Authorization` and value `Bearer <RESEND_API_KEY>`. All 14 email
  nodes were converted from SendGrid to HTTP Request calls against
  `https://api.resend.com/emails` and expect that credential.

Placeholders reading `<__PLACEHOLDER_VALUE__...__>` must be filled in on
import: the Twilio from-number, the Resend `From` header (needs a domain
verified in Resend), the billing portal URL, and the platform owner's Slack
channel / email in WF7.

## Per-company setup

Alerts silently no-op when their target column is null:

- `companies.owner_slack_channel` → Slack alerts
- `companies.owner_phone` → billing-lifecycle SMS (WF7)
- `companies.service_area_lat` / `service_area_lng` → weather alerts (WF6)
- `companies.google_review_link` → review requests
- `jobs.scheduled_at` → confirmation SMS (WF2 skips jobs without it)

`scheduled_at` is new. The app writes `scheduled_date` + `scheduled_window`
(a text range); WF2 needs a precise timestamp, so until the booking flow
populates `scheduled_at`, WF2 will find nothing.

## What was changed from the originals

Schema reconciliation (migrations 072–074):

- `contacts` → **`customers`** (our table name)
- `companies.company_name` → **`name`**, `owner_email` → **`contact_email`**,
  `google_review_url` → **`google_review_link`**, `service_type` → **`trade`**
- `leads` → **`marketing_leads`** — `public.leads` already exists and is
  tenant-scoped; Sable's own funnel needed a separate table
- WF7's company lookup → **`companies_with_billing`**, a view joining
  `subscriptions.stripe_customer_id` (that column isn't on `companies`)
- `jobs.status = 'booked'` filter → **`status in (unassigned, assigned)`**
- Confirmation replies write **`jobs.confirmation_state`**, not `jobs.status`.
  Writing 'confirmed' into `jobs.status` would have broken every dispatch view
  that filters on the real vocabulary.
- Added: `confirmation_requests`, `tasks`, `nurture_log`, `marketing_leads`
  tables; `jobs.scheduled_at/service_type/confirmation_state/...`;
  `customers.source/last_seen_at/last_job_completed_at`;
  `companies.owner_phone/owner_slack_channel/service_area_*`
- Widened `companies_status_check` to accept `payment_failed` (WF7 writes it)
  and `nurture_log.status` to accept WF5's `stopped_booked` /
  `no_contact_info`

Only references to real Supabase rows were renamed. Workflow-internal bundle
keys (`d.company_name`, `$('Set Bundle').item.json.owner_email`) deliberately
keep their original names.

Behaviour changes:

- **All 14 SendGrid nodes → HTTP Request against the Resend API**, since this
  project sends through Resend. Email failures are set to `neverError` so a
  bounced courtesy email can't fail an invoice run.
- **WF3's review branch removed** — see the overlap table above.

## Regenerating

`scripts/adapt-n8n-workflows.py` rewrites the originals. It's idempotent —
re-run it if the source workflows are revised rather than hand-editing these.

## Cron times

Schedules are stored in **UTC** and set for MDT (UTC−6): `0 14 * * *` = 08:00
MDT. They will drift an hour during Mountain Standard Time; adjust in n8n if
that matters.
