# Deploy checklist — audit fixes + recent features

Everything below was committed as **files only**; nothing has touched the
live Supabase project or Stripe yet. Apply in this order. Migrations 065–070
are independent of each other except where noted, but applying in number
order is safest.

## 0. Pre-flight (read-only verification the audit couldn't do)

- [ ] **RLS coverage (audit C4):** run the Supabase **Security Advisor**
      (`get_advisors` type `security`). Confirm no "RLS disabled" / "policy
      missing" findings, especially on `job_status_events`, `job_type_parts`,
      `campaign_enrollments`, `revenue_snapshots`. Fix any before launch. Do
      NOT blanket-enable RLS without adding matching policies — that denies
      all access.
- [ ] **stripe-webhook auth (audit C3):** in Edge Functions → `stripe-webhook`
      → confirm **`verify_jwt` is OFF**. Stripe sends no Supabase JWT; if it's
      ON, every billing event 401s and `subscriptions` never syncs. Re-deploy
      with `--no-verify-jwt` if needed.

## 1. Database migrations (apply in order)

- [ ] `065_fallback_voicemail` — `customers.capture_method` + `voicemail`
      call outcome.
- [ ] `066_job_portal_token` — `jobs.portal_token` (enables pgcrypto).
- [ ] `067_warranty_callback_config` — `companies.callback_window_days` +
      `jobs.callback_needs_review`.
- [ ] `068_self_serve_cancellation` — `subscriptions.cancellation_reason` +
      `admin_company_cancellations()` RPC.
- [ ] `069_align_plans_to_marketing` — **verify the plans table row keys
      first.** This UPDATEs rows keyed `starter`/`growth`/`pro`. If your live
      `plans` table uses different keys, adjust the migration before running.
      After it runs, confirm the app shows Solo $399 / Team $699 / Fleet $999.
- [ ] `070_suppress_review_on_negative_feedback` — trigger on `feedback`.

## 2. Edge functions to deploy (new)

- [ ] `fallback-voicemail`  — deploy **with `verify_jwt` OFF** (Twilio caller,
      shared-secret auth).
- [ ] `job-status`          — deploy **with `verify_jwt` OFF** (public portal,
      token-scoped).
- [ ] `change-subscription-plan` — deploy with `verify_jwt` ON (owner session).

## 3. Edge functions to re-deploy (changed this session)

- [ ] `create-subscription-checkout` — now adds the 7-day trial + `starter`.
- [ ] `cancel-subscription` — stores optional cancellation reason.
- [ ] `send-on-the-way-sms` — adds the portal tracking link.
- [ ] `stripe-webhook` — (re-confirm `verify_jwt` OFF per step 0).

## 4. Stripe + secrets

- [ ] Create a recurring **$399/mo Price** for Solo in Stripe → set
      `STRIPE_PRICE_STARTER`. Confirm `STRIPE_PRICE_GROWTH` ($699) /
      `STRIPE_PRICE_PRO` ($999) exist and match the new plan prices.
- [ ] Edge Function secrets: `FALLBACK_VOICEMAIL_WEBHOOK_SECRET`,
      `OUTAGE_ALERT_URL` (+ `OUTAGE_ALERT_WEBHOOK_SECRET`), `PORTAL_BASE_URL`
      (e.g. `https://runsable.com`).
- [ ] Vapi: set the phone number's **fallback destination** to the Twilio
      voicemail that POSTs to `fallback-voicemail` (see receptionist-server
      README "Outage safety net").

## 5. Post-deploy smoke checks

- [ ] Sign up a test company → lands in Stripe Checkout showing a 7-day
      trial, card required, correct plan price.
- [ ] Complete a job → open the portal link from the on-the-way SMS.
- [ ] Leave negative `feedback` on a job with a pending review run → confirm
      the run flips to `cancelled`.
- [ ] Owner → Settings → Billing → "Change plan" switches tier (Stripe shows
      a proration).

## Still open (not in this deploy — decisions/builds pending)

- **Invoice generation (I5):** nothing writes `invoices` yet; Document Vault
  + portal invoice stay empty. Needs an amount source + `invoices.status`
  constraint check before building.
- **Setup fee:** advertised but not auto-charged; collected at onboarding.
- **n8n double-send (I7):** verify no n8n workflow duplicates the in-app
  review/nurture automations.
