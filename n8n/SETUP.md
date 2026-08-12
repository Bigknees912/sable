# n8n Setup Guide

Complete checklist for wiring up the 14 automation workflows. All workflows are adapted and ready to import; this covers credentials and post-import configuration.

## Credentials Checklist

### Already Available (from your Supabase/Stripe/Resend setup)

| Credential | Where to find | Status |
|---|---|---|
| `SUPABASE_URL` | Root `.env.example` line 6, or Supabase dashboard | ✅ Have it |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Project Settings → API → service_role secret | ⏳ Needed for n8n |
| `STRIPE_SECRET_KEY` | Stripe dashboard → Developers → API keys | ✅ Have it |
| `RESEND_API_KEY` | Resend dashboard → API Keys | ✅ Have it |

### Need to Get (Twilio)

| Credential | Where to get | Status |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio console → Account Info | ⏳ Waiting on you |
| `TWILIO_AUTH_TOKEN` | Twilio console → Account Info | ⏳ Waiting on you |
| `TWILIO_FROM_NUMBER` | Twilio console → Phone Numbers → Active | ⏳ Waiting on you |

### Need to Create (Stripe Webhook)

| Credential | What it is | Where to set up |
|---|---|---|
| `STRIPE_WEBHOOK_SECRET` | Signing secret for Stripe → n8n webhooks | Stripe dashboard → Developers → Webhooks |
| Webhook endpoint URL | `https://n8n.runsable.app.n8n.cloud/webhook/stripe` (example) | Same Stripe webhooks page |

### Optional (Slack alerts)

| Credential | Used by | When needed |
|---|---|---|
| `SLACK_WEBHOOK_URL` or `SLACK_BOT_TOKEN` | WF3b (feedback alerts), WF7 (churn alerts) | Only if `companies.owner_slack_channel` is populated |

## Credentials to Create in n8n

Once you have the values above, create these in n8n (Settings → Credentials & Resources → Create new):

### 1. Supabase (for all workflows)
- **Type:** Supabase
- **Host:** `https://umtoseyxvszdxbuvuyuk.supabase.co` (or your URL from SUPABASE_URL)
- **API Key:** Paste `SUPABASE_SERVICE_ROLE_KEY` here
- ⚠️ **This is a service-role key—it bypasses RLS.** Keep this credential local to n8n only.

### 2. Twilio (for SMS workflows: WF2, WF2b, WF4, WF6, WF7)
- **Type:** Twilio
- **Account SID:** Paste `TWILIO_ACCOUNT_SID`
- **Auth Token:** Paste `TWILIO_AUTH_TOKEN`

### 3. Stripe (for payment workflows: WF3, WF7, WF8a, WF8b)
- **Type:** Stripe
- **API Key:** Paste `STRIPE_SECRET_KEY`

### 4. Resend (for email: all 14 workflows)
- **Type:** Header Auth
- **Credential Name:** **Must be named exactly `Resend`** (case-sensitive)
- **Header:**
  - Name: `Authorization`
  - Value: `Bearer <RESEND_API_KEY>`

### 5. Slack (optional)
- **Type:** Slack
- Create a bot in your Slack workspace, grab the token, and paste it here.
- Only needed if you populate `companies.owner_slack_channel`.

## Placeholders to Fill In After Import

After importing each workflow JSON, look for `<__PLACEHOLDER_VALUE__...>` strings and replace them:

| Placeholder | What it is | Example |
|---|---|---|
| `<__PLACEHOLDER_VALUE__Twilio From header, e.g. Sable <alerts@runsable.com>__>` | Twilio from-number (the phone number customers see as sender) | `+14155552671` or `Sable` (alphanumeric sender ID in some regions) |
| `<__PLACEHOLDER_VALUE__Resend From header, e.g. Sable <alerts@runsable.com>__>` | Email sender (name + verified Resend domain) | `Sable <alerts@runsable.com>` (domain must be verified in Resend) |
| `<__PLACEHOLDER_VALUE__Stripe billing portal URL__>` | Link to customer self-serve billing | `https://billing.stripe.com/b/...` (get from Stripe dashboard) |
| `<__PLACEHOLDER_VALUE__platform owner Slack channel or email, e.g. #alerts or owner@company.com__>` | Where to send critical alerts (WF7 only) | `#alerts` or `owner@example.com` |

## Stripe Webhook Setup

n8n workflows listen for these Stripe events via webhook. Set this up in Stripe:

1. **Stripe dashboard** → Developers → Webhooks → Add endpoint
2. **Endpoint URL:** `https://your-n8n-instance.cloud/webhook/stripe`
   - Replace `your-n8n-instance` with your actual n8n URL.
   - Example: `https://runsable.app.n8n.cloud/webhook/stripe`
3. **Events to send:**
   - `customer.subscription.created`
   - `customer.subscription.deleted`
   - `customer.subscription.updated`
   - `invoice.payment_failed`
   - `invoice.payment_succeeded` (optional; WF8a uses this to clear the retry queue)
4. **After creating:** Copy the **Signing secret** and store it securely.

The webhook signing secret is **not** used by n8n (n8n auto-verifies), but keep it for your records.

## Per-Workflow Tweaks

### WF2: Pre-appointment confirmation SMS
- Requires `jobs.scheduled_at` to be populated by your booking flow.
- Currently, your booking flow writes `scheduled_date` + `scheduled_window` (text range).
- **Action:** Update booking flow to also write `scheduled_at` as an ISO timestamp, or WF2 will find no jobs to confirm.

### WF4 vs. send-on-the-way-sms edge function (conflict)
- Both send "Tech is on the way" SMS.
- WF4 includes a live map link; the edge function includes the customer portal link.
- **Action:** Disable one or you'll double-text every customer.
  - To disable the edge function: remove its HTTP trigger or delete the deployment.
  - To disable WF4: deactivate it in n8n.

### WF5: Nurture reactivation
- Triggers via webhook: `POST /webhook/sable-nurture-campaign`
- Also runs daily at 06:00 MDT to re-evaluate stale leads.
- **Action:** Your app needs to POST `{company_id, customer_id}` to this webhook when initiating a nurture campaign from a UI, or it only runs on the daily schedule.

### WF10: Seat-limit upsell
- Triggers via webhook: `POST /webhook/seat-change`
- Payload: `{company_id, technician_count, event: "member_joined"}`
- **Action:** Your app needs to POST to this webhook when a technician joins a team, or nudges never fire.

## Activation Checklist

- [ ] All 5 credentials created in n8n
- [ ] All 4 placeholders replaced with real values
- [ ] Stripe webhook endpoint created and signing secret saved
- [ ] `jobs.scheduled_at` populated by booking flow (or WF2 will be empty)
- [ ] Decision made: disable WF4 or disable send-on-the-way-sms edge function
- [ ] App wired to POST `/webhook/sable-nurture-campaign` (optional; WF5 has daily fallback)
- [ ] App wired to POST `/webhook/seat-change` when technicians join (optional; upsells won't fire without it)

## After Activation

Once workflows are running, monitor:

1. **WF8a (payment retry poller)** — runs every 6h. Check `payment_retry_queue` table to see dunning state.
2. **WF9 (usage-drop alert)** — runs Mondays 08:00 MDT. Check `usage_weekly` view to verify counts are correct.
3. **WF2 (confirmation SMS)** — skips jobs with null `scheduled_at`. If you see no jobs being picked, check that column in the jobs table.
4. **Slack / Twilio failures** — workflows silently no-op if targets aren't configured (null in companies columns), but check logs if you expect alerts and aren't seeing them.

## Troubleshooting

**WF2 finds no jobs:**
- Check: does your jobs table have `scheduled_at` populated? If only `scheduled_date` + `scheduled_window` exist, WF2 can't parse them as precise timestamps.
- Fix: update booking flow to write `scheduled_at`.

**SMS not sending:**
- Check: is Twilio credential wired? Is the from-number a valid Twilio number?
- Check: does `companies.owner_phone` exist for the company being notified?

**Emails not sending:**
- Check: is the Resend credential named exactly `Resend`? (case-sensitive)
- Check: is the `From:` domain verified in Resend?
- Check: are HTTP nodes set to `neverError = true`? (they should be; email failures shouldn't fail the whole workflow)

**Stripe webhook not triggering:**
- Check: is the endpoint URL correct in Stripe dashboard?
- Check: are all 4 event types subscribed to?
- Stripe dashboard → Webhooks → click the endpoint → scroll to "Events sent" to see the last 30 attempts.

**Payment retry queue not moving:**
- Check: does WF8a have a valid Stripe credential?
- Check: does WF8a have a valid Supabase credential?
- Check: is WF8a actually active (not paused)?
- Check: `payment_retry_queue` table — is there a row? Is `status = 'pending'`?

## Reference Links

- n8n instance: `https://runsable.app.n8n.cloud`
- n8n docs: https://docs.n8n.io
- Supabase dashboard: https://app.supabase.com
- Stripe dashboard: https://dashboard.stripe.com
- Resend dashboard: https://resend.com/emails
- Twilio console: https://www.twilio.com/console
