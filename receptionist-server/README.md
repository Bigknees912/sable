# Sable AI Receptionist — Real Phone Deployment

This is the actual server that answers real phone calls once wired up. It
ports the pricing and scheduling logic from the chat demo into three tools
Vapi's voice AI calls mid-conversation, and writes real bookings straight
into the same Supabase database the dashboard app reads — a job Alex books
shows up on the owner's Jobs board and calendar without anyone re-entering
it. You do the account setup yourself (I can't create accounts or enter
payment details for you), but every piece of code is done.

## What each piece does

- `server.js` — the webhook. Vapi hits this whenever the assistant needs a
  price, an available slot, or to book a job.
- `lib/pricing.js` — quotes a job using *this company's own* `job_types`
  catalog and `companies` pricing defaults (base fee, hourly rate, urgency
  multipliers) - the same data the dashboard's Settings > Service Catalog
  page edits. There's no hardcoded plumbing price list here anymore.
- `lib/scheduling.js` — generates candidate slots and checks them against
  real `jobs` rows in Supabase (by date + time window) so two callers can't
  get double-booked.
- `lib/booking.js` — creates/reuses the `customers` row, inserts the `jobs`
  row, and keeps a `calls` row (quote given, outcome) in sync across the
  whole conversation.
- `lib/supabase.js` — the Supabase client, authenticated as the service
  role since a phone call has no logged-in user to scope RLS to.
- `lib/assistantConfig.js` — pure function that builds the Vapi assistant
  definition (voice, system prompt, and the three tools) from this
  company's real trade and service catalog. An electrician's generated
  prompt only ever mentions the job types in their own catalog - there's
  no shared plumbing vocabulary left to leak from.
- `generate-assistant.js` — CLI that fetches this company's real data and
  runs it through `lib/assistantConfig.js`, replacing the old checked-in
  `vapi-assistant.json` (which was one hardcoded plumbing prompt for every
  deployment). Re-run this any time the service catalog changes materially
  and re-upload the result to Vapi.

## Step 0: Point this server at a real company

This server has no concept of "no company yet" — every booking needs a
`company_id` to attach to. Sign up as the owner through the dashboard app
first (see the root `AUTH.md`), then in the Supabase dashboard: **Table
Editor → companies**, copy the `id` of your row, and set it as
`SUPABASE_COMPANY_ID` (see `.env.example`). Nothing in this server will
work correctly until that's set.

## Step 1: Create accounts

1. Sign up at [vapi.ai](https://vapi.ai) — this is the voice AI layer, it
   handles speech-to-text, text-to-speech, and the phone call itself.
2. Sign up at [twilio.com](https://twilio.com) and buy a Calgary (403/587/825)
   local number under Phone Numbers → Buy a Number. Costs about $1-2/month
   plus per-minute usage.

## Step 2: Connect Twilio to Vapi

You don't write any Twilio code. Vapi imports the number directly:

1. In the Vapi dashboard, go to Phone Numbers → Import.
2. Choose Twilio, paste your Twilio Account SID and Auth Token (found in
   your Twilio console), and select the number you bought.
3. Vapi now owns the call routing for that number.

## Step 3: Deploy the webhook server

This server needs to be reachable on a public URL, since it's on your
laptop right now and Vapi can't reach `localhost`. Easiest free options:
[Render](https://render.com), [Railway](https://railway.app), or
[Fly.io](https://fly.io). Any of them:

1. Push this folder to a GitHub repo (or drag-and-drop deploy where supported).
2. Set the start command to `npm start`.
3. Once deployed, you'll get a URL like `https://sable-receptionist.onrender.com`.

To test locally first instead, install the Vapi CLI and tunnel your machine:

```bash
npm install
npm start
# in a second terminal:
vapi listen --forward-to localhost:3000/vapi/webhook
```

## Step 4: Create the assistant

Make sure the company has at least one active service in its catalog
first (dashboard → Settings → Service Catalog - it pre-fills from a trade
starter template at signup, but needs to actually exist before generating
an assistant). Then generate the assistant definition from that company's
real trade and services:

```bash
npm install
node generate-assistant.js https://YOUR-DEPLOYED-SERVER.example.com/vapi/webhook > assistant.generated.json
```

This reads `SUPABASE_COMPANY_ID` (Step 0), pulls the company's `trade` and
active `job_types`, and writes a ready-to-upload Vapi assistant JSON with a
system prompt and tool schemas built from that company's actual services -
an electrician's version never mentions drains, a locksmith's never
mentions furnaces. Open the generated file and drop a real `voiceId` into
the `voice` block (browse voices in the Vapi dashboard under Voice
Library) before uploading.

Then create the assistant via the API:

```bash
curl --location 'https://api.vapi.ai/assistant' \
  --header 'Authorization: Bearer YOUR_VAPI_API_KEY' \
  --header 'Content-Type: application/json' \
  --data @assistant.generated.json
```

This returns an assistant ID. In the Vapi dashboard, go to Phone Numbers,
select your imported Twilio number, and assign this assistant to it.

**If the service catalog changes later** (a new job type, a repriced
service), re-run the `generate-assistant.js` command and update the
assistant via `PATCH https://api.vapi.ai/assistant/{id}` with the new
JSON, so Alex's script and prices stay in sync with what the dashboard
actually offers.

## Step 5: Call it

Call the Twilio number from your own phone. You're talking to Alex, live,
running your actual pricing and scheduling logic.

## Things to tighten before handing this to a real client

- **Security**: set `VAPI_WEBHOOK_SECRET` in your deployment's environment
  variables and add the matching Authorization header in Vapi's tool
  config, so randoms can't hit your webhook directly. Separately, guard
  `SUPABASE_SERVICE_ROLE_KEY` closely — it bypasses every RLS policy in the
  database, unlike the publishable key the browser app uses.
- **Untested call-context assumption**: `server.js` reads the caller's
  phone number and Vapi's call id from `message.call.id` /
  `message.call.customer.number` on the webhook body, per Vapi's
  documented server-message format — but this hasn't been exercised
  against a real live call yet. First real test call, check the Supabase
  `calls` table (or Render's logs) to confirm `vapi_call_id` and
  `customer_phone` actually populated; if not, check the raw payload
  shape (Vapi dashboard → Calls → your call → "Logs" has the raw webhook
  body) and adjust `server.js`'s `callContext` extraction.
- **SMS confirmation**: Vapi has a built-in `sms` tool that can text the
  customer a booking confirmation right after the call, using the Twilio
  account you already connected. Worth adding once the core flow works.
- **Outage safety net (do this before going live with a real client)**:
  the whole pitch is "you never miss a call" - two layers protect that:
  1. *Our own server hiccups*: `lib/outageAlert.js` counts tool-call
     failures per company, and once 3 happen inside 5 minutes, POSTs to
     `OUTAGE_ALERT_URL` (the deployed `receptionist-outage-alert` edge
     function) with the shared secret `OUTAGE_ALERT_WEBHOOK_SECRET` set on
     both sides. That function texts the company's owner directly (looked
     up from `profiles` where `role = 'owner'`) and logs the incident to
     `receptionist_outage_alerts`. Deploy the function, set both env vars
     on the server, and set `OUTAGE_ALERT_WEBHOOK_SECRET`/`TWILIO_*` on the
     function itself, or this only logs to the console (still visible in
     Sentry, just not proactive). Individual failed tool calls also no
     longer leak a raw `Error: ...` string to the model - the caller hears
     "someone will call you back," and a `customer_interactions` row gets
     created automatically so the office actually follows up.
  2. *Vapi or the whole webhook is unreachable, not just one tool call*:
     that's outside anything our own code can catch, since Vapi never
     reaches us at all. In the Vapi dashboard, on the phone number itself
     (not the assistant), set a **fallback destination** - a real human
     line (the office's cell, an answering service) that Vapi forwards to
     if the assistant can't be reached. This is the actual backstop for a
     total platform outage; there is no code path for it, it's a dashboard
     setting, and it's the single highest-value 5 minutes you can spend
     before handing this to a paying client.
  3. *Voicemail fallback that still captures the lead* (the version a client
     actually wants): instead of forwarding a total-outage call to a dead
     line, point the Vapi phone number's fallback destination at a Twilio
     number whose TwiML plays a short greeting and records a message —
     "Thanks for calling {company}, we're having a brief issue, please
     leave your name and number and we'll call you back within the hour."
     Configure that `<Record>`'s `transcribeCallback` /
     `recordingStatusCallback` to POST to the deployed
     `fallback-voicemail` Supabase edge function with the
     `x-webhook-secret: FALLBACK_VOICEMAIL_WEBHOOK_SECRET` header (and the
     company id as `companyId`). That function lands the caller as a **New
     Lead flagged `capture_method='fallback_voicemail'`** — shown with a
     "Fallback voicemail" badge on the Clients board so it's never confused
     with a normal AI call — records a `voicemail`-outcome call with the
     transcription, and fires the same monitoring alert as layer 1 so you
     hear about the outage before the client does. Set
     `FALLBACK_VOICEMAIL_WEBHOOK_SECRET` (and `OUTAGE_ALERT_URL` /
     `OUTAGE_ALERT_WEBHOOK_SECRET` for the alert) as secrets on that
     function; unconfigured, it still logs loudly to the console/Sentry.
- **Per-client setup**: `lib/pricing.js` and `lib/assistantConfig.js` both
  read this company's own `companies`/`job_types` rows - to resell this to
  a second company of any trade, copy the project, point
  `SUPABASE_COMPANY_ID` at their row, run `generate-assistant.js`, and
  create a second Vapi assistant, Supabase company, and Twilio number. No
  code changes needed per client.
