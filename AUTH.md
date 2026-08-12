# Auth & Database

Supabase project: `umtoseyxvszdxbuvuyuk` (ca-central-1). URL and publishable
key are in `.env.example`. Generated types are in `db.types.ts`.

The database/RPC layer below was built first; a real auth frontend (login,
signup, employee join-code flow) now exists under `src/`, wired to it.
`app-demo.jsx`'s dashboard (jobs board, calendar, map, CRM, etc.),
`voice-receptionist-demo.html`, and `marketing-site.html` remain
behavior/design references, not code to build on top of directly — only the
auth screens have been ported to real code so far.

## Running the frontend

This machine doesn't have Node.js installed, so the app has been written
but not installed or run. Once Node is available:

```
npm install
cp .env.example .env   # already has real project values filled in
npm run dev
```

## Frontend implementation

`src/App.jsx` is a small state machine driven by `supabase.auth` session
state plus whether a `profiles` row exists for that user:

| `session` | `profile` | Screen |
|---|---|---|
| checking | — | loading |
| `null` | — | `LoginScreen` / `SignupScreen` / `CheckEmailScreen` |
| set | checking | loading |
| set | `null` | `RoleChoiceScreen` → `OwnerOnboardingScreen` or `EmployeeJoinScreen` |
| set | set | signed-in placeholder (name/role/company + Sign Out) |

**Why role selection happens *after* `signUp()`, not before it** (this is
the one real deviation from `app-demo.jsx`'s screen order): the demo's
`OwnerSignup`/`EmployeeSignup` screens collect business name / join code
*together with* email+password, because the demo's "session" is just local
state that appears instantly. A real `supabase.auth.signUp()` can return
with no session at all if the project requires email confirmation — the
user has to click a link in their inbox, which is a full page navigation
that would lose any in-memory form state. So `SignupScreen` only collects
credentials; once a session exists (immediately, or after the user
confirms and logs back in — same code path either way) and no `profiles`
row is found yet, `RoleChoiceScreen` picks up and finishes the job with
`OwnerOnboardingScreen` (business name, owner name, trade, team size,
service area) or `EmployeeJoinScreen` (name, join code), calling the RPCs
below. This also naturally covers first-time Google sign-in, which lands
authenticated with no prior role choice at all.

Files: `src/lib/supabaseClient.ts` (client), `src/lib/auth.js` (thin
wrappers over `supabase.auth.*` and the two RPCs), `src/auth/*.jsx`
(screens + shared styling ported from the demo's `LIGHT` palette and
`AuthShell`/`FieldLabel`/`TextInput`/etc. building blocks), `src/App.jsx`
(the state machine above).

## Dashboard screens (jobs, calendar, home)

`app-demo.jsx`'s `OwnerHome`, `JobsBoard`, `CalendarPage`, and `TechHome`
are ported to `src/dashboard/*.jsx`, reading and writing the real tables
instead of local state. `src/dashboard/AppShell.jsx` replaces the
placeholder screen in `App.jsx` once a profile exists, and only shows the
tabs that are wired up (`Home`, `Jobs`, `Calendar`, `Clients`, `Automations`
for owners) — the demo's Map/Insights/Team/Settings tabs aren't part of
this pass.

Data access lives in `src/lib/jobs.js`, `src/lib/dashboard.js`, and
`src/lib/timeEntries.js` — plain functions wrapping `supabase.from(...)`
queries, mirroring the pattern in `src/lib/auth.js`. Every read relies on
RLS to scope results to the caller's company (no manual `company_id`
filtering needed); every insert into `customers`/`jobs`/`time_entries`
relies on those columns' `DEFAULT public.current_company_id()` (added in
migration `012_default_company_id_on_client_inserts`) rather than the
client supplying `company_id` itself — simpler call sites, and it closes
off a spoofing vector.

**Seeded job types**: `job_types` starts empty for a new company, which
would leave `JobsBoard`'s "New Job" form with nothing to pick from.
Migration `011_seed_default_job_types` seeds the six plumbing job types
from `receptionist-server/lib/pricing.js`'s `JOB_TYPES` whenever a
`trade: 'Plumbing'` company is created. Other trades get no defaults yet.

**Features intentionally dropped**, because they had no real data behind
them in the demo and this task is specifically about persistence:
- Weather-alert banner (`OwnerHome`) — hardcoded Calgary forecast.
- "Recovered" stat (`OwnerHome`) — replaced with "Completed Today", a real
  count from `jobs`.
- Confirmation-SMS simulate-yes/simulate-reschedule buttons
  (`CalendarPage`) — no SMS backend exists.
- AI job-report generation and the "on the way" SMS preview (`TechHome`) —
  the demo called the Anthropic API directly from the browser with no
  backend proxy or API key; `Mark Complete` now just saves the tech's own
  notes straight to `jobs.notes`.
- Fake per-pair distance hash in the assign picker (`JobsBoard`) —
  replaced with a real haversine calculation (`distanceKm` in
  `src/lib/jobs.js`) over `jobs.lat/lng` and `tech_locations.lat/lng`, but
  those columns have no geocoding or GPS pipeline populating them yet, so
  it will show "—" until one exists.

**Not built**: job photo attachments, and anything under the demo's
Map/Insights/Team/Settings tabs.

## CRM pipeline (Clients page)

`src/dashboard/ClientsPage.jsx` — didn't exist in any prior pass (the
demo's `ClientsPage` was explicitly out of scope until now). Built as a
GoHighLevel-style drag-and-drop pipeline: **New Lead → Contacted → Quoted
→ Booked → Completed → Nurture**, using `@dnd-kit/core` (`MouseSensor` +
`TouchSensor`, not `PointerSensor` — see the code comment in
`ClientsPage.jsx`; a plain `PointerSensor` would intercept touch input
too, breaking the board's horizontal scroll on mobile).

**Design decision worth flagging**: those six stages don't map cleanly
onto any single existing table (`leads.status` only has
new/contacted/converted/lost; "Quoted"/"Booked"/"Completed" are job
concepts; "Nurture" is a `nurture_campaigns` concept). Rather than trying
to *derive* a stage from scattered job/lead state, `customers` gained an
explicit `pipeline_stage` column (migration
`018_customers_pipeline_stage`) that only ever changes two ways:

1. A card is dragged to a new column (`updateContactStage` in
   `src/lib/crm.js`) - optimistic update, reverted with an `ErrorBanner`
   if the write fails.
2. A customer-creation call site picks a sensible starting stage:
   `findOrCreateCustomer` (`src/lib/jobs.js`, used by `JobsBoard`'s New
   Job form) and `receptionist-server/lib/booking.js`'s phone-booking flow
   both default new customers to `'booked'` (a job is being created right
   alongside), while the Clients page's own "Add Contact" defaults to
   `'new_lead'`. Neither path ever touches an *existing* customer's
   stage — a manual drag never gets silently overwritten by a later job.

**Nothing auto-advances a stage** from job status changes, deposit
payments, or completions (e.g. a job going `done` does not automatically
drag its customer to "Completed"). This is a deliberate scope decision,
not an oversight — auto-advancement means deciding whether automation is
allowed to override a manual placement (e.g. a customer someone
deliberately moved to "Nurture"), which is a business-logic call this
task didn't specify. Wiring it up later would mean a DB trigger on
`jobs`/`invoices` updating `customers.pipeline_stage`, following the same
pattern as the SMS triggers above.

**`leads` table still isn't wired up**: the marketing site's lead form
remains a client-side stub (`console.log`, no Supabase write — see its
own code comment), so this pipeline only reflects customers created
through the app itself. A future pass connecting the marketing site would
most naturally insert directly into `customers` at `'new_lead'` rather
than `leads`, to land straight on this board.

Realtime: `customers` was added to the `supabase_realtime` publication
(same migration), and `useJobsRealtime.js` was generalized into
`useTableRealtime.js` (table name is now a parameter) so `ClientsPage` can
reuse it — `useJobsRealtime` itself is now a two-line wrapper around it,
kept so `OwnerHome`/`JobsBoard`'s existing imports didn't need to change.

### Tags and the interaction timeline

Clicking a card opens `src/dashboard/ContactDetailModal.jsx`, which adds
two things per contact, from migration `019_contact_tags_and_interactions`:

- **`customers.tags text[]`** — plain array, not a separate tags table +
  join. The examples given ("repeat customer", "referred by Sarah") are
  ad-hoc, often contact-specific text, not a controlled vocabulary worth
  normalizing. The modal still offers lightweight autocomplete: `allTags`
  (every distinct tag already used across the company) is computed
  client-side in `ClientsPage.jsx` from the contacts already loaded — no
  extra query — and shown as click-to-add suggestions. Saved via
  `updateContactTags`, optimistic with revert-on-failure, and patches the
  board's local state directly (`onTagsChanged`) rather than waiting on a
  full reload or the realtime round-trip.
- **`customer_interactions` table** — the timeline. Deliberately *not*
  the same table as `calls` (that's the AI receptionist's automated Vapi
  call log — vapi_call_id, quote_low/high — a different concern from a
  person typing "called to follow up, left voicemail"). `type` is
  `'note'` or `'call'`, picked via a toggle in the composer.
  `company_id`/`created_by` are both DB-side defaults
  (`current_company_id()` / `auth.uid()`), same convention as everywhere
  else — never supplied by the client.
- **Append-only by design**: there's no UPDATE policy on
  `customer_interactions`. It's meant to read like an audit trail —
  corrections are new entries, not edits to history. A DELETE policy
  exists (creator or owner) for cleaning up a genuine mistake, but no UI
  button calls it yet since removal wasn't asked for; it's there at the
  RLS layer if it's ever needed directly.
- **Card-vs-drag click handling**: `ContactCard` has both `@dnd-kit`
  drag listeners *and* an `onClick` to open the detail modal on the same
  element. This works because of the sensors' `activationConstraint`
  (`distance`/`delay`) — a plain tap that doesn't cross that threshold
  never becomes a drag, so the click fires normally. If drag-vs-click
  ever misbehaves after real testing, that constraint tuning is the first
  place to look.

### Loading and error handling

Every screen follows the same pattern via `src/dashboard/useAsyncData.js`:
`loading` is only ever true before the *first* successful load; once data
has loaded once, a later failure (e.g. a realtime-triggered background
refresh) sets `error` without wiping the screen back to a loading/blank
state - existing data stays on screen with a dismissible `ErrorBanner`
(with Retry) on top of it, rather than a full-page `ErrorState` replacing
everything. `ErrorState`/`ErrorBanner`/`LoadingState` all live in
`src/dashboard/ui.jsx`. Every mutation (assign, deposit, clock in/out,
start job, complete job, save notes, sign out) has its own
loading/disabled state on the specific control and surfaces failures
instead of failing silently - there is no bare `.then()` without a
`.catch()`, and no `onClick` wired directly to an unguarded async
function, anywhere in `src/`.

## receptionist-server → same database

`receptionist-server` (the Vapi phone AI) now reads/writes the exact same
`jobs`/`customers`/`calls`/`job_types` tables instead of a local
`bookings.json` file — a job Alex books over the phone is a real row the
owner's Jobs board and Home stats can see. Details:

- **New files**: `receptionist-server/lib/supabase.js` (service-role
  client — there's no logged-in user on a phone call, so it bypasses RLS
  and must filter by `company_id` explicitly on every query),
  `lib/booking.js` (`recordQuote` upserts a `calls` row keyed by Vapi's
  call id every time `get_quote` runs; `createBooking` finds/creates the
  `customers` row, inserts the `jobs` row, marks the call `outcome:
  'booked'`). `lib/scheduling.js` was rewritten to check real `jobs` rows
  for conflicts instead of `bookings.json`.
- **New required env vars** (`receptionist-server/.env.example`):
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (from the Supabase dashboard
  — never expose client-side, unlike the publishable key), and
  `SUPABASE_COMPANY_ID` — this deployed server answers calls for exactly
  one company, so it needs that company's id. **There's no company to
  point it at until someone completes owner signup through the dashboard
  app once** — this is a hard prerequisite, not just a nice-to-have.
- **`customerName` added**: `customers.name` is `NOT NULL`, but the voice
  flow never asked for one. `vapi-assistant.json`'s system prompt and the
  `book_appointment` tool schema now collect it before booking.
- **Live dashboard updates**: `jobs` was added to the `supabase_realtime`
  publication (migration `013_enable_realtime_on_jobs`), and
  `src/dashboard/useJobsRealtime.js` subscribes `OwnerHome`/`JobsBoard` to
  it (filtered to the company, still RLS-scoped per client) — a phone
  booking appears without the owner refreshing.
- **Untested against a real call**: `server.js` assumes Vapi's webhook
  body carries the caller's number and call id at
  `message.call.customer.number` / `message.call.id`, per Vapi's
  documented format — this hasn't been exercised against an actual phone
  call yet. First real test call, check the `calls` table (or Render
  logs) to confirm those populated.

## Deposit collection (Stripe)

Real Stripe Checkout, not a fake "Send Deposit Link" button — the demo's
button had no `onClick` at all. Runs as two Supabase Edge Functions, source
in `supabase/functions/`:

- **`create-deposit-checkout`** (`verify_jwt: true`) — called from
  `JobsBoard`'s "Send Deposit Link" button via
  `supabase.functions.invoke(...)`, which auto-attaches the owner's
  session JWT. Re-validates server-side that the job is actually over
  `companies.deposit_threshold` (never trusts the client), checks the
  caller's `profiles.role` is `'owner'` (defense-in-depth beyond RLS —
  a tech *could* technically hit this for their own assigned job per the
  `jobs_update` policy, but the button only exists on the owner-only Jobs
  board, so the function enforces that same boundary), creates a real
  Stripe Checkout Session for the computed deposit amount, and sets
  `jobs.deposit_status = 'pending'` + `stripe_checkout_session_id`. Uses a
  per-request client built from the forwarded `Authorization` header (not
  the service role) so it's RLS-scoped to the caller's own company, same
  guarantee as every other write in this app.
- **`stripe-webhook`** (`verify_jwt: false` — Stripe has no Supabase
  session; the `Stripe-Signature` header verified inside the function *is*
  the auth) — listens for `checkout.session.completed` and flips
  `jobs.deposit_status` to `'paid'` with `deposit_paid_at`, matched by
  both `job_id` (from Stripe's session `metadata`) and
  `stripe_checkout_session_id`. Uses the service-role client, same pattern
  as `receptionist-server`.

**Schema**: `jobs` gained `deposit_status` (`none`/`pending`/`paid`),
`deposit_amount` (locked in at send-time — a later change to
`deposit_pct` in Settings doesn't retroactively change what was already
requested), `stripe_checkout_session_id`, `deposit_paid_at`. `jobs` was
already in the Realtime publication (from the phone-booking work), so a
webhook-driven `'paid'` flip shows up live on the dashboard too, same as
everything else.

**One-time Stripe setup** (I can't create the account or click through
their dashboard for you):
1. Sign up at [stripe.com](https://stripe.com) (or use an existing
   account). Toggle **Test mode** first — use test card `4242 4242 4242
   4242`, any future expiry/CVC, to try this end-to-end before going live.
2. **Developers → API keys**: copy the **Secret key**.
3. Supabase dashboard → **Edge Functions → Secrets** (no CLI needed):
   add `STRIPE_SECRET_KEY` with that value.
4. **Developers → Webhooks → Add endpoint**: URL
   `https://umtoseyxvszdxbuvuyuk.supabase.co/functions/v1/stripe-webhook`,
   event: `checkout.session.completed`. After creating it, copy its
   **Signing secret** and add it in the same Supabase Secrets page as
   `STRIPE_WEBHOOK_SECRET`.
5. Flip to **Live mode** and repeat steps 2 and 4 (test and live keys/
   webhooks are separate in Stripe) once you're ready for real charges.

**Known limitation**: there's no automated delivery (SMS/email) of the
checkout link — "Send Deposit Link" opens a modal with the real Stripe URL
for the owner to copy/open and share manually (read it over the phone,
text it themselves). Wiring actual SMS delivery would reuse the Twilio
account already connected for the receptionist.

## Review-request SMS on job completion

**Superseded by the automation builder below.** The hardcoded trigger
described in this section was retired in migration
`024_retire_hardcoded_review_trigger_and_seed_default`, which drops
`jobs_completed_send_review`/`notify_job_completed()` and seeds an
equivalent-but-editable `automations` row instead (same message, now with
a 24-hour delay instead of firing instantly, and the owner can change or
disable it without a migration). The Edge Function and Vault secret
described below (`send-review-request`, `job_completed_webhook_secret`)
are now dead code/unused — left in place rather than deleted, but nothing
calls them anymore. This section is kept for history; see "Automation
builder" for the mechanism actually running today.

Real Twilio SMS, fired server-side the instant a job's status becomes
`'done'` — not triggered by any client code, so it fires reliably
regardless of which screen (or future path) completes the job. The demo's
comment on `FEEDBACK` said this outright: *"In production this comes from
the same review-request text the job completion already sends"* — this is
that text.

**Architecture** (source in `supabase/functions/send-review-request/`):
- A Postgres trigger (`jobs_completed_send_review`, migration
  `015_review_request_on_job_complete`) fires `after update on jobs`,
  guarded by `new.status = 'done' and old.status is distinct from 'done'`
  so it only fires on the transition into done, not on later edits to an
  already-completed job.
- The trigger function (`notify_job_completed`, `security definer` so it
  can read the shared secret regardless of which role — owner or tech —
  triggered the update) calls `net.http_post` (the `pg_net` extension) to
  hit the `send-review-request` Edge Function, async so it doesn't block
  the status-update write.
- **Auth between the trigger and the function**: there's no Supabase user
  session on a DB trigger, so a shared secret is used instead — generated
  with `gen_random_bytes()` *inside* Postgres and stored in Supabase Vault
  (`job_completed_webhook_secret`), rather than passed in as a literal
  value. This matters: `apply_migration` calls persist their SQL text in
  Supabase's migration history, so a hardcoded secret there would sit in
  plaintext right next to the Vault entry meant to protect it. The trigger
  reads it from `vault.decrypted_secrets` and sends it as `x-webhook-secret`;
  the edge function checks it against its own `JOB_COMPLETED_WEBHOOK_SECRET`
  secret. **To get the value for that edge function secret**, run this
  yourself in the Supabase SQL Editor (deliberately not something I ran and
  printed here — no reason to route a live secret through my output when
  you can pull it directly):
  ```sql
  select decrypted_secret from vault.decrypted_secrets where name = 'job_completed_webhook_secret';
  ```
- The function looks up the job's customer + company, skips gracefully
  (no SMS, no error) if there's no phone on file or `companies.google_review_link`
  isn't set, normalizes the phone to E.164, and sends via Twilio's REST
  API directly (`fetch` + Basic auth — no SDK needed).

**Required Edge Function secrets** (Supabase dashboard → Edge Functions →
Secrets, same no-CLI path as the Stripe secrets):
- `JOB_COMPLETED_WEBHOOK_SECRET` — the value from the SQL query above.
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` — from the Twilio console
  (same account already set up for the AI receptionist).
- `TWILIO_FROM_NUMBER` — the Twilio number already connected to Vapi, in
  E.164 format (e.g. `+14035551234`). One number handles both inbound
  voice and outbound SMS.

**Setting the company's review link**: `companies.google_review_link` is
now collected as an optional field during self-serve signup (see "Self-serve
onboarding & billing") — get the link from Google Business Profile → "Ask
for reviews" (a short `g.page/r/.../review` link) or a
`search.google.com/local/writereview?placeid=...` URL for the business's
Place ID. For a company that already exists and skipped it, there's still
no Settings screen to edit it through, so it's a manual Table Editor edit
(or ask me to run the update query) until that's built.

**Message sent**: `"Hi {FirstName}, thanks for choosing {CompanyName}! If
you have a minute, a quick Google review helps us a lot: {link}"`.

## "On the way" SMS on job start

Same trigger/Vault/edge-function pattern as the review-request SMS above,
fired when a tech taps Start Job (`jobs.status` transitions to
`'in_progress'`). Because `TechHome`'s Start Job button already just does
a plain `jobs.status` update through `advanceJobStatus()`, **no frontend
change was needed at all** — the trigger fires on that write regardless.

- Trigger: `jobs_started_send_on_the_way` → function `notify_job_started()`
  (migration `017_on_the_way_sms_on_job_started`) → Edge Function
  `send-on-the-way-sms` (source in `supabase/functions/`).
- Own dedicated Vault secret, `job_started_webhook_secret` (not shared
  with the review-request trigger's secret — smaller blast radius if one
  ever leaks). Get its value the same way, run yourself in the SQL Editor:
  ```sql
  select decrypted_secret from vault.decrypted_secrets where name = 'job_started_webhook_secret';
  ```
  Set it as the edge function's `JOB_STARTED_WEBHOOK_SECRET` secret.
  `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_FROM_NUMBER` are shared
  with `send-review-request` (same Twilio account and number).
- **"Live Google Maps link" honestly means**: an interactive
  `maps.google.com` URL to the job's address — the same URL `TechHome`'s
  own Navigate button already uses — not real-time GPS tracking of the
  tech. There's no location pipeline (`tech_locations` has no GPS source
  feeding it), so this doesn't pretend to show where the tech actually is,
  only where they're headed. A genuine live-tracking page would need a
  GPS ingestion pipeline from the tech's phone plus a public tracking
  page — a materially bigger feature than "send a text."
- No client-visible confirmation that the text sent (unlike the deposit
  flow, which shows the Stripe URL directly) — this fires from Postgres
  via `pg_net`, fire-and-forget, so the browser never learns the outcome.
  Check Edge Function logs (Supabase dashboard → Edge Functions →
  send-on-the-way-sms → Logs) to confirm sends.

**Message sent**: `"Hi {FirstName}, {TechFirstName} from {CompanyName} is
on the way to {address}. {mapsLink}"`.

## Automation builder

`src/dashboard/AutomationsPage.jsx` (owner-only tab) — GoHighLevel-style
no-code rules: **when** a trigger fires, **wait** an optional delay, **then**
run an action. Built as a **form-based builder**, not a visual
drag-and-drop canvas: a list of rule cards, each created/edited through a
form (trigger dropdown + config, delay amount/unit, action dropdown +
config). Same no-code outcome as a node-graph editor, a fraction of the
engineering effort, and no new UI dependency — this was an explicit scope
choice (asked and confirmed) over building a canvas library integration.

**Schema** (migration `021_automations_schema`, `action_type` extended to
include `send_email` in migration `026_automation_email_channel`):
- **`automations`** — one row per rule: `trigger_type`
  (`job_status_changed` / `pipeline_stage_changed` / `tag_added`) +
  `trigger_config` (jsonb, e.g. `{"status": "done"}`), `delay_minutes`,
  `action_type` (`send_sms` / `send_email` / `add_tag` / `change_stage` /
  `add_note`) + `action_config` (jsonb, e.g. `{"message": "..."}` for SMS or
  `{"subject": "...", "body": "..."}` for email), `active` toggle.
  Owner-only read/write via RLS, same `current_role() = 'owner'` pattern as
  other settings tables.
- **`automation_runs`** — the delay queue. One row enqueued per matching
  trigger event, `scheduled_for = now() + delay`, `status`
  (`pending`/`sent`/`failed`/`cancelled`). This is how a "wait 24 hours"
  step exists at all — a Postgres trigger can't block/sleep, so instead it
  enqueues a future row that a scheduled job later picks up and executes.

**Trigger detection** (migration `022_automation_trigger_detection`): two
`AFTER UPDATE` triggers, `jobs_status_automations` and
`customers_automations`, each `security definer`. On a matching column
change (job `status`, customer `pipeline_stage`, or a newly-added
`customers.tags` entry — diffed via `array_agg(...) where t <> all(old.tags)`),
they look up every `active` automation with a matching `trigger_type`/
`trigger_config` for that company and insert an `automation_runs` row
with `scheduled_for = now() + (delay_minutes || ' minutes')::interval`.

**Loop prevention**: an automation's own action (e.g. `change_stage`) could
itself match another automation's trigger, cascading indefinitely. Both
trigger functions check a session-local flag,
`current_setting('app.automation_processing', true) = 'true'`, and skip
enqueueing if it's set. `run_due_automations()` (below) sets that flag for
the duration of its run, so nothing the automation engine does can ever
enqueue further runs — only real user/API actions can.

**Scheduler** (migration `023_automation_scheduler`): `pg_cron` (installed
via Supabase's documented pattern —
`create extension pg_cron with schema pg_catalog; grant usage on schema cron to postgres; ...`,
not a bare `create extension pg_cron`) runs `run_due_automations()` every
minute (`cron.schedule('run-due-automations', '* * * * *', ...)`). Each
run: sets the loop-prevention flag, pulls up to 100 due
(`status = 'pending' and scheduled_for <= now()`) rows, and for each one
dispatches on `action_type` — `add_tag`/`change_stage`/`add_note` are
applied directly in SQL; `send_sms` renders the message (template
variables substituted via a `replace()` chain) and calls the
`run-automation-sms` Edge Function through `net.http_post`; `send_email`
renders `subject` and `body` the same way and calls `run-automation-email`.
Both channel functions are authenticated with the same Vault secret
(`automation_webhook_secret`, generated with `gen_random_bytes()` inside
Postgres, same reasoning as the SMS secrets above — never a literal in
migration SQL; reused across both functions rather than split, since they
share one caller and trust boundary). Each row is processed in its own
`begin/exception` block so one failure (e.g. bad phone number, no email on
file) doesn't stop the batch — it's marked `status = 'failed'` with the
error message instead.

**Email channel** (migration `026_automation_email_channel`, Edge Function
`run-automation-email`): sends via [Resend](https://resend.com)'s REST API
(`fetch` + Bearer auth, no SDK — same convention as the Twilio calls). Uses
`customers.email` (already existed on the table; no schema change needed
there); if a matched customer has no email on file, the run is skipped
gracefully (`status = 'sent'`, no error) rather than treated as a failure,
matching how `send_sms` skips customers with no phone. Plain-text body, not
HTML/WYSIWYG — "simple template editor" here means a subject field plus a
body textarea with variable substitution, matching the SMS composer's
level of complexity rather than building a rich-text editor.

**Building an email *sequence***: there's no separate "sequence" concept in
the schema — a sequence is just multiple `send_email` automations sharing
the same trigger (e.g. `pipeline_stage_changed` → `nurture`) with staggered
`delay_minutes` (0, then 3 days, then 7 days, ...). Each is its own rule in
the list, independently editable/toggleable. This was a deliberate reuse of
the existing trigger → wait → action primitive rather than adding a new
"multi-step campaign" object — it produces the same result (a drip of
emails after a contact lands in Nurture) without a second builder UI.

**Template variables** available in a `send_sms` message, or a `send_email`
subject/body (see `SMS_VARIABLES` in `src/lib/automations.js` — the name
predates the email channel but the variable set and substitution logic are
shared across both): `{{first_name}}`, `{{name}}`, `{{company_name}}`,
`{{job_description}}`, `{{job_address}}`, `{{review_link}}`.

**Default automation**: every new company gets one pre-seeded rule on
signup (`create_company_and_owner`, updated in migration `024`) — "Ask for
a Google review," `job_status_changed` → `done`, 24-hour delay, `send_sms`
with the same message the old hardcoded trigger sent. This replaces that
old trigger (see "Review-request SMS" above) rather than running alongside
it, so completed jobs aren't double-texted. The owner can edit or disable
it like any other rule.

**Required Edge Function secrets** (Supabase dashboard → Edge Functions →
Secrets — these are project-wide, so setting them once covers every
function, not just the automation ones): both `run-automation-sms` and
`run-automation-email` need `AUTOMATION_WEBHOOK_SECRET` (get the value the
same way as the other webhook secrets — SQL Editor, not printed here):
```sql
select decrypted_secret from vault.decrypted_secrets where name = 'automation_webhook_secret';
```
`run-automation-sms` also needs
`TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_FROM_NUMBER`, shared with
the other SMS functions. `run-automation-email` needs:
- `RESEND_API_KEY` — from [resend.com](https://resend.com) → API Keys,
  after creating an account and verifying a sending domain (Resend
  requires a verified domain before it'll send from an address on it).
- `RESEND_FROM_EMAIL` — the address to send from, e.g.
  `notifications@yourdomain.com`, on that verified domain.

**Not built**: `pipeline_stage_changed` and `tag_added` triggers exist at
the schema/detection level but have no seeded default automations using
them yet — the form builder supports creating them, just nothing does by
default. `automation_runs` has no UI (no "view scheduled/sent runs" list)
— `AutomationsPage` only reads/writes `automations` itself.

## Signup flow

A new `auth.users` row has no `company_id` or `role` yet, so two RPCs bridge
that gap. Call one of them client-side immediately after
`supabase.auth.signUp()` / Google OAuth completes and the user has answered
"starting a business" vs. "joining a team" (mirrors the demo's
`SignupChoice` screen):

- **Owner**: `supabase.rpc('create_company_and_owner', { p_business_name, p_owner_name, p_trade, p_team_size, p_service_area, p_plan, p_google_review_link })`
  Creates the `companies` row (with a join code, and the review link if one
  was given), the caller's `profiles` row (`role: 'owner'`), and a
  `subscriptions` row on the chosen `p_plan` (`starter` if omitted). See
  "Self-serve onboarding & billing" below for what `p_plan` actually does.
  Returns the new `companies` row.
- **Tech**: `supabase.rpc('join_company_as_tech', { p_join_code, p_name })`
  Looks up the company by join code and creates the caller's `profiles` row
  (`role: 'tech'`). Raises `invalid join code` if no match — surface that as
  the same "That join code doesn't match any company" error the demo shows.
- **Regenerate join code**: `supabase.rpc('regenerate_join_code')` — owner
  only, returns the new code. Used by the Team page's regenerate button.

Both signup RPCs reject a second call for the same user (`profile already
exists for this user`) — a user can only belong to one company.

After either RPC succeeds, fetch the caller's `profiles` row to get
`role`/`company_id` and drive which UI (`owner` vs `tech` tabs) to show —
same split as `AppShell` in the demo.

## Self-serve onboarding & billing

The full owner signup wizard now has 4 steps with no manual step by you in
between: **Sign up** (`SignupScreen`, email/password or Google) → **Choose
your plan** (`PlanSelectionScreen`, new) → **Set up your business**
(`OwnerOnboardingScreen`, extended) → done. This closes the two gaps that
previously required you to do something by hand for every new company:
picking/paying for a plan wasn't possible at all (every company silently
got `starter` for free, forever), and `companies.google_review_link` had
no UI — the only way to set it was a manual SQL edit (see the "Superseded"
note under "Review-request SMS" for that old instruction).

**`PlanSelectionScreen.jsx`** (`src/auth/PlanSelectionScreen.jsx`, new step
in `App.jsx`'s `postAuthScreen` state machine, between `role-choice` and
`owner-onboarding`): shows the 3 plan cards from `src/lib/plans.js`'s
`PLANS` array and hands the chosen key up to `App.jsx` (`selectedPlan`
state), which passes it into `OwnerOnboardingScreen` as a prop. **The
prices shown are placeholders** ($0 / $49 / $149) — they're just display
text in `plans.js`, safe to edit freely. What actually charges a card is
the Stripe Price object each paid plan maps to (below), so changing a
number in `plans.js` alone does nothing to real billing.

**`OwnerOnboardingScreen.jsx`** now also collects an optional Google review
link (self-serve replacement for the old manual SQL step), and its submit
does one more thing after `create_company_and_owner()` succeeds: if the
chosen plan isn't `starter` (free), it calls `create-subscription-checkout`
and redirects the browser to the returned Stripe-hosted Checkout URL
(`window.location.href = url`). If that call itself fails — most likely
because Stripe pricing isn't configured yet, see below — the workspace was
still created successfully (that already committed), so the owner isn't
stranded: an alert explains billing didn't finish and they're dropped into
the dashboard anyway, on whatever plan/status `create_company_and_owner`
already set.

**Plan → subscription status**, decided inside `create_company_and_owner`
(migration `029`): `starter` has no Stripe involved at all and starts
`status: 'active'` immediately (same default behavior as before this
task). `growth`/`pro` start `status: 'incomplete'` — a new value added to
`subscriptions.status`'s check constraint — until Stripe Checkout actually
completes and the webhook flips it to `'active'`. **Nothing in the app
currently gates features by plan or status** — this is intentionally just
correct, honest data for now; building paywalled features is a separate,
unrequested task. `status: 'incomplete'` companies can use the app exactly
like `active` ones today.

**`create-subscription-checkout`** (Edge Function, `verify_jwt: true`) —
mirrors `create-deposit-checkout`'s pattern exactly: an RLS-scoped client
built from the caller's forwarded JWT resolves *their own* `company_id`
and `role` server-side (never trusts a client-supplied company id),
rejects non-owners, maps the requested plan to a Stripe Price via env var
(`STRIPE_PRICE_GROWTH` / `STRIPE_PRICE_PRO`), and creates a `mode:
'subscription'` Checkout Session. `company_id` and `plan` are set as
metadata on **both** the Checkout Session and, via `subscription_data.metadata`,
the underlying Stripe Subscription object itself — the latter is what lets
`stripe-webhook` route `customer.subscription.updated`/`.deleted` events
(which don't carry the session's own metadata) back to the right company
row. If the relevant `STRIPE_PRICE_*` secret isn't set yet, this returns a
clear 500 with an explanatory message instead of an opaque crash.

**`stripe-webhook`** now handles three event types instead of one:
- `checkout.session.completed` branches on `session.mode` — `'payment'`
  is the existing job-deposit flow (unchanged); `'subscription'` fetches
  the full Stripe Subscription object (for `current_period_end`, which the
  Checkout Session itself doesn't carry) and syncs it to `subscriptions`.
- `customer.subscription.updated` / `customer.subscription.deleted` keep
  `subscriptions.status`/`current_period_end` in sync with Stripe's actual
  billing state after the initial checkout — a failed renewal, a
  cancellation, etc. Stripe's own statuses (`trialing`, `unpaid`,
  `incomplete_expired`, `paused`, ...) are collapsed onto our 4-value
  check constraint by `mapSubscriptionStatus()` in the function.

**One-time Stripe setup to finish self-serve billing** (extends the
existing "One-time Stripe setup" steps under "Deposit collection" — same
Stripe account, same `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` already
configured there):
1. **Products → Add product**, one each for Growth and Pro, with a
   **recurring** Price (monthly, whatever amount you actually want to
   charge — the `plans.js` display prices are just placeholders and don't
   need to match until you edit them to match). Copy each Price's ID
   (`price_...`).
2. Supabase dashboard → **Edge Functions → Secrets**: add
   `STRIPE_PRICE_GROWTH` and `STRIPE_PRICE_PRO` with those Price IDs.
3. On the **same** webhook endpoint you already created for deposits
   (`.../functions/v1/stripe-webhook`), add two more listened events:
   `customer.subscription.updated` and `customer.subscription.deleted`
   (`checkout.session.completed` is already there). No new endpoint, no
   new signing secret — it's the same `STRIPE_WEBHOOK_SECRET`.
4. Repeat both steps in **Live mode** once you're ready for real charges
   (test and live Products/Prices are separate in Stripe, same as the
   deposit flow's test/live keys).

Until step 1–2 are done, `PlanSelectionScreen` still works and companies
still get created on any plan — `create-subscription-checkout` just
returns a clear "billing isn't set up yet" error, which the owner sees as
a non-blocking alert (see above), not a broken signup.

**Verified**: a rolled-back transactional test (nothing committed) called
`create_company_and_owner` end-to-end with a `growth` plan and a review
link and confirmed the resulting row has `plan: 'growth'`, `status:
'incomplete'`, and the review link set; a second run with no plan/link
arguments confirmed the `starter`/`active`/`null` defaults still work
unchanged; a second signup attempt for the same user was correctly
rejected. **Bug caught and fixed during this pass**: `CREATE OR REPLACE
FUNCTION create_company_and_owner(...)` with two new parameters doesn't
replace the original 5-argument function in Postgres — a different
parameter list is a different *overload*, so the old 5-arg version was
still sitting there afterward, un-migrated grants and all (still
`anon`/`PUBLIC`-executable, unlike the tightened 7-arg version). Caught via
`get_advisors` showing the same function twice, fixed by dropping the old
overload explicitly (migration `031`). **Lesson**: `CREATE OR REPLACE
FUNCTION` only replaces a function whose parameter list is identical
(including order and types) to what's being created — adding, removing, or
reordering parameters always creates a new overload alongside the old one
unless you explicitly `DROP FUNCTION` the old signature first.

## Google OAuth setup (manual, one-time)

Supabase's Google provider is not yet enabled — you need to do this
yourself since it requires a Google Cloud account:

1. In [Google Cloud Console](https://console.cloud.google.com), create a
   project (or reuse one), then **APIs & Services → Credentials → Create
   Credentials → OAuth client ID**, type "Web application".
2. Add authorized redirect URI:
   `https://umtoseyxvszdxbuvuyuk.supabase.co/auth/v1/callback`
3. Copy the generated Client ID and Client Secret.
4. In the Supabase dashboard: **Authentication → Providers → Google**,
   paste both values in, and enable the provider.
5. In the Supabase dashboard: **Authentication → URL Configuration**, add
   `http://localhost:5173` (Vite's dev server) to **Redirect URLs**, plus
   your real domain once deployed. `signInWithGoogle()` in
   `src/lib/auth.js` passes `redirectTo: window.location.origin`, and
   Supabase rejects any redirect target not on this allowlist.
6. Once enabled, the "Continue with Google" button already wired up in
   `LoginScreen`/`SignupScreen` works — same post-auth `RoleChoiceScreen`
   flow as email/password to attach the user to a company.

## SMS consent & compliance

**This is a good-faith technical implementation informed by researched
TCPA (US), CASL (Canada), and Twilio/CTIA guidance current as of this
build (July 2026) — it is not legal advice, and hasn't been reviewed by a
lawyer.** Requirements shift, and how these rules apply to a specific
business's actual message content is a judgment call a lawyer should make
before relying on this in production, especially given real penalties on
both sides of the border (US: **$500–$1,500 statutory damages per
message**, uncapped; Canada: **up to $10M CAD per violation** for a
business under CASL). Treat what's below as a solid foundation, not a
substitute for that review.

**What was researched and why it shaped the design**:
- **TCPA** treats informational/transactional texts (appointment
  reminders, status updates — most of what this app sends) as needing
  only *prior express consent*, which can be oral; *marketing* texts need
  the higher bar of *prior express written consent*. Since April 2025, the
  FCC also requires honoring opt-out requests through any reasonable
  method, not just a STOP reply.
- **CASL** requires *express or implied* consent for any commercial
  electronic message, sender identification, and an unsubscribe mechanism
  — with the burden of proof on the sender to show consent was obtained.
- **Twilio/CTIA** best practice for opt-in messaging wants clear consent
  capture, message-frequency and rate disclosure, and STOP/HELP handling.
  Twilio itself already auto-blocks sends to a number that's replied STOP
  to a Toll-Free or Long Code number — even without a Messaging Service —
  returning error code **21610**.

**Design decision — one consent flag, not two tiers**: rather than
tracking "transactional consent" separately from "marketing consent," this
app captures a single `sms_consent` per customer, using disclosure
language that covers the *broader* marketing-level bar. Reasoning: the
automation builder (see "Automation builder" above) lets an owner write
completely arbitrary SMS content — a status update today, a promotional
offer tomorrow — so the schema has no reliable way to classify a given
message's category at send time. Consenting to the broader category
covers the narrower one automatically; splitting them would require
trusting the owner to correctly tag every automation's intent, which isn't
enforceable.

### Schema (migration `032_sms_consent`)

- **`customers.sms_consent` / `sms_consent_at` / `sms_consent_method`** —
  current state, checked before every send. `sms_consent_method` is one of
  `'phone_call'` (captured verbally by the AI receptionist),
  `'web_form'` (a rep captured it in the dashboard), or
  `'twilio_opt_out_keyword'` (Twilio told us they replied STOP).
- **`sms_consent_events`** — append-only audit trail, one row per consent
  change. This is the actual compliance artifact: CASL puts the burden of
  proof on the sender to show consent was obtained, so "we have a boolean
  column" isn't enough on its own — a timestamped history of exactly when,
  how, and (for dashboard-captured consent) which team member captured or
  revoked it is what a real audit needs. **No UPDATE or DELETE policy** —
  stricter than `customer_interactions`' precedent (which allows delete
  for genuine mistakes), deliberately: a consent record that can be edited
  or removed after the fact isn't evidence of anything.
- **`record_sms_consent(p_customer_id, p_consent, p_method, p_note)`** —
  the only way the frontend changes consent state; updates `customers` and
  inserts the audit event atomically, and verifies (via `auth.uid()` +
  `current_company_id()`) that the customer belongs to the caller's own
  company before touching anything — verified live with a rolled-back
  transactional test showing a cross-company attempt is rejected with
  `customer not found`. Owner- or tech-callable (any company member can
  add a contact), granted to `authenticated` only, revoked from
  `anon`/`PUBLIC`.

Service-role contexts (`receptionist-server`, and the SMS edge functions'
own opt-out handling below) write both tables directly instead of calling
the RPC — they already bypass RLS and have no `auth.uid()` to check
against, so the RPC's authorization logic doesn't apply to them anyway.

### Where consent gets captured

- **`JobsBoard`'s New Job form** and **`ClientsPage`'s Add Contact form**
  (`src/dashboard/JobsBoard.jsx`, `ClientsPage.jsx`): a checkbox appears
  once a phone number is entered — *"Customer consented to receive text
  messages"* — default **unchecked**. A pre-checked box isn't valid
  consent under either TCPA or CASL guidance, so this is a deliberate
  default, not an oversight. The hint text under it is the exact script
  (`smsConsentScript()` in `src/lib/smsConsent.js`) the rep should have
  read or conveyed to the customer before checking it — this is an
  attestation by the rep, not something the customer fills in themselves,
  since these are owner/tech-facing forms. Checking it calls
  `record_sms_consent` right after the customer is created/found
  (`findOrCreateCustomer` in `lib/jobs.js`, `createContact` in
  `lib/crm.js`) — it only ever turns consent **on** here; leaving the box
  unchecked means "no verified consent yet," not "revoke."
- **`ContactDetailModal`**: shows current consent status (green "SMS
  consent on file" / gray "No SMS consent on file") with a tap-to-toggle —
  the one place consent can be **revoked** through the dashboard, for when
  a customer asks not to be texted after the fact. Same optimistic-update-
  with-revert pattern as the tag editor next to it.
- **Phone booking (`receptionist-server`)**: Alex (the AI receptionist)
  now asks a fixed, word-for-word permission question — see the
  `systemPrompt` in `vapi-assistant.json` — after getting the caller's
  name and before offering appointment times, on *every* call, including
  returning customers (re-asking is more friction but never
  non-compliant; under-asking is the actual risk). The `book_appointment`
  tool gained an `smsConsent` boolean parameter the assistant sets based
  on a clear yes; `server.js` forwards it (`args.smsConsent === true`,
  so anything except an explicit `true` defaults to no consent) into
  `createBooking()`, which — like the frontend paths — only ever turns
  consent **on**, never revokes based on a call where it wasn't
  re-confirmed.

### Enforcement at send time

Every SMS-sending Edge Function (`send-on-the-way-sms`, `run-automation-sms`
— the two live paths — plus `send-review-request`, which is dead code
today but was patched too in case it's ever revived) now selects
`sms_consent` alongside `phone` and skips gracefully
(`{ skipped: "customer has not consented to SMS" }`) if it's false, the
exact same pattern already used for "no phone on file." `run-automation-sms`
additionally appends `"Reply STOP to opt out."` to any message that
doesn't already mention it — a single choke point that guarantees the
disclosure regardless of what an owner types into an automation, rather
than trusting every hand-authored message to include it themselves.

**Closing the loop with Twilio's own opt-out handling**: when a Twilio
send fails with error code **21610** (recipient previously replied STOP),
each function now also flips `customers.sms_consent` to `false`
(`sms_consent_method: 'twilio_opt_out_keyword'`) and logs an
`sms_consent_events` row, best-effort. Twilio already blocks the send at
the carrier level regardless of anything this app does — but without this,
our own `sms_consent` flag would stay stale forever, meaning every future
automation or trigger would keep trying and keep silently failing against
a number that's already opted out, and the dashboard would keep showing
"consent on file" for a customer who explicitly said stop.

### Not built

- No dedicated "consent history" view in the dashboard — `sms_consent_events`
  exists and is fully populated, but nothing in the UI reads it back yet
  beyond the current-state toggle in `ContactDetailModal`.
- The marketing site's lead form still isn't wired to Supabase (see "CRM
  pipeline" above), so it isn't part of this pass either — when it is,
  its own consent capture will need the same treatment.
- No automated handling of non-STOP opt-out channels (email reply, phone
  call, a support ticket) beyond the manual `ContactDetailModal` toggle —
  the FCC's April 2025 "any reasonable method" guidance means a rep who
  hears "please stop texting me" on a call should use that toggle, since
  there's no automatic detection for anything other than a Twilio STOP
  reply.

## Terms of Service, Privacy Policy & data deletion requests

**Same disclaimer as the SMS consent section above, and it matters more
here: `terms.html` and `privacy.html` are legal documents, generated as a
good-faith starting template informed by researched GDPR (right to
erasure, Article 17) and PIPEDA (access/disposal, the "Openness"
principle) requirements current as of this build. They have not been
reviewed by a lawyer and should be before a real business relies on
them.** The template covers standard terms (quotes non-binding until
confirmed, deposit/payment terms, licensing disclaimer, liability
limitation, Alberta/Canada governing law) and standard privacy disclosures
(what's collected, why, which subprocessors touch it, retention, rights,
breach notification) — but it can't know your actual insurance coverage,
your actual retention practices, or your actual subprocessor list if it
changes. Update the content in those files (and the placeholder contact
emails/phone number) before publishing.

**Important scoping note**: `marketing-site.html` is a single plumbing
company's own public-facing website (the fictional "Sable Plumbing &
Drain" reference tenant), not the SaaS platform's own marketing site — so
these Terms/Privacy Policy govern that company's relationship with the
*homeowners* who call them for service, not Sable-the-software's
relationship with the plumbing businesses that use it. That's a
deliberate reading of the existing file's content (hero copy, lead form,
"Licensed & Insured, Alberta" footer) — a future per-tenant site generator
would need its own copy of these three pages per company.

### New pages

- **`terms.html`** / **`privacy.html`** — static pages matching the main
  site's visual style (same CSS custom properties, fonts), linked from
  every page's footer. `privacy.html` documents the real third parties
  this app actually uses (Twilio for SMS, Stripe for payments, Vapi/
  Anthropic for the AI receptionist, Resend for email, Supabase — hosted
  in Canada — for the database) rather than generic boilerplate, since
  those are the actual data flows in this codebase.
- **`data-request.html`** — a form for access/correction/deletion
  requests, submitted directly to the `submit-data-request` Edge Function
  (below) via `fetch()`, using the project's publishable key (safe to
  embed client-side, same as any Supabase anon key). Confirms with a
  visible "Request received" state and a follow-up confirmation email.

### `data_deletion_requests` (migration `034`)

Public-facing intake — the requester (a homeowner, not a dashboard user)
typically has no account in this system at all, so this can't be scoped
by `current_company_id()` the way every other table in this app is. Only
the service role writes to it (via the Edge Function below), matching how
`leads`/`calls` already handle public-facing writes in this app — never
a raw anon RLS insert policy.

- **`request_type`**: `access` / `correction` / `deletion` — the form
  supports all three since PIPEDA and GDPR both mandate access-request
  handling equally with erasure, not just deletion.
- **`due_date`**: set to 30 days from submission at insert time
  (PIPEDA's access-request timeline; GDPR's is "without undue delay,
  within one month," effectively the same baseline) — a concrete,
  queryable deadline rather than just a policy statement.
- **`company_id`**: nullable, best-effort resolved by matching the
  requester's freeform `company_name_provided` against `companies.name`
  in the Edge Function. Not load-bearing for anything — the notification
  email below is the real mechanism that ensures a human sees the
  request — just a convenience for a possible future owner-facing view.
  A `SELECT` policy (`company_id = current_company_id() and
  "current_role"() = 'owner'`) exists for that future view even though
  no page reads it yet.
- **Who actually handles these today**: there's no Sable-platform
  admin panel in this app (every other table is scoped to a single
  tenant; this one deliberately isn't, since a request may not even name
  the right company). Today, requests are triaged by whoever holds
  `PRIVACY_CONTACT_EMAIL` — the platform operator — via the notification
  email plus direct Supabase Table Editor access, same as several other
  platform-level operational tasks already documented in this file (e.g.
  setting `companies.google_review_link` before self-serve onboarding
  existed). A company owner who wants to act on a request about their own
  customer uses the `ContactDetailModal` action below.

### `submit-data-request` Edge Function

`verify_jwt: false` (public - no Supabase session exists for a website
visitor), validates the request, inserts into `data_deletion_requests`,
then best-effort sends two emails via Resend (reusing the
`RESEND_API_KEY`/`RESEND_FROM_EMAIL` secrets from the automation email
channel): one to `PRIVACY_CONTACT_EMAIL` with the full request detail and
due date, one to the requester confirming receipt. Both emails are
best-effort — the request is already durably saved before either send is
attempted, so a Resend hiccup never surfaces as a failed submission to
the requester.

**New required secret**: `PRIVACY_CONTACT_EMAIL` (Supabase dashboard →
Edge Functions → Secrets) — the inbox that gets notified of every new
request. Not set yet; without it, requests still save correctly, they
just don't trigger the internal notification email (the requester's
confirmation email still sends, as long as Resend itself is configured).

### Fulfilling a deletion request: `anonymize_customer_pii` (migration `033`)

GDPR's Article 17 and PIPEDA's disposal principle both recognize an
exception to erasure for data an organization is legally required to keep
(accounting, tax, warranty records) — so this **anonymizes a customer's
identifying fields in place rather than deleting the row**:
`name`→`'Deleted Customer'`, `phone`/`email`/`address`/`referral_code`/
`referred_by`→`null`, `tags`→`{}`, SMS consent forced off (logged to
`sms_consent_events` with the new `'pii_deletion'` method - added to
*both* the `sms_consent_events.method` and `customers.sms_consent_method`
check constraints; the first pass only caught the former, and a
rolled-back transactional test caught the mismatch before it shipped).
`customers.pii_deleted_at` is set as the audit marker. **Jobs, invoices,
and the interaction timeline are left completely untouched** - those are
the legitimate business records the exception exists for.

Owner-only (`SECURITY DEFINER`, checked explicitly like
`record_sms_consent`), granted to `authenticated` only, verified live via
a rolled-back transactional test (successful same-company anonymization,
plus a rejected cross-company attempt).

**Known limitation, documented rather than solved**: `customer_interactions`
entries (notes, call logs) are free text and may mention the customer's
name — anonymizing the `customers` row doesn't retroactively scrub
mentions already written into old interaction notes. `ContactDetailModal`'s
delete confirmation copy says this explicitly ("review those separately if
they mention the customer by name") rather than silently under-delivering
on "erasure." Building real text redaction across freeform notes is a much
bigger, different problem than this task scoped for.

**Where it's triggered**: `ContactDetailModal`'s "Delete this contact's
personal data" danger-zone action (bottom of the modal, only shown for a
contact that hasn't already been anonymized) — requires an explicit
second tap to confirm, the one two-step confirmation in this app, since
every other destructive action here (deleting an automation, removing a
tag) is both easily undoable and far lower-stakes than irreversibly
scrubbing a real person's contact information. Once deleted, the modal
shows a "personal data deleted on [date]" banner in place of the contact
info block, and hides the tag editor and SMS consent toggle (nothing left
to tag or consent about) while keeping the interaction timeline visible.

## Error tracking (Sentry)

Every runtime in this app — the React dashboard, `receptionist-server`,
and all 8 Supabase Edge Functions — now reports unexpected errors to
Sentry instead of only writing to a log nobody's watching. Same "code now,
configure secrets later" pattern as every other integration in this app:
none of this does anything until you create a Sentry project and set the
DSN secrets below, but nothing breaks or needs code changes when you do.

### What's covered, and what deliberately isn't

- **Frontend** (`src/lib/sentry.js`, initialized in `src/main.jsx`):
  Sentry's default browser integrations auto-capture uncaught exceptions
  and unhandled promise rejections; a new `Sentry.ErrorBoundary` around
  `<App />` catches render crashes React itself can't recover from, with
  a plain, dependency-free fallback screen ("Something went wrong...
  Reload") so a broken render doesn't also break the error screen.
  **Deliberately not instrumented**: the individual `try/catch` blocks in
  `usePendingAction`/`useAsyncData` that already show `ErrorBanner`/
  `ErrorState` — most of what lands there is expected business logic (a
  bad join code, a job under the deposit threshold, Stripe not configured
  yet), not a bug. Reporting all of it to Sentry would bury real signal
  under routine, already-handled user errors. If you want a *specific*
  handled path reported too (e.g. every failed deposit checkout, not just
  crashes), add `Sentry.captureException(err)` at that call site — those
  two hooks are the natural extension points.
- **`receptionist-server`** (`instrument.js`, loaded first in `server.js`
  before anything else — required for Sentry's auto-instrumentation of
  other modules to work): every per-tool-call error in the Vapi webhook
  handler (`get_quote`/`check_availability`/`book_appointment`) is now
  reported — this was the most important gap to close, since a failed
  booking previously just became a vague thing Alex says on the call, with
  nothing anywhere recording that it happened. `Sentry.setupExpressErrorHandler(app)`
  is also wired in as a catch-all for anything that escapes that.
- **Edge Functions**: each of the 8 functions
  (`create-deposit-checkout`, `create-subscription-checkout`,
  `stripe-webhook`, `send-on-the-way-sms`, `send-review-request`,
  `run-automation-sms`, `run-automation-email`, `submit-data-request`)
  gained a same-directory `_sentry.ts` (content identical across all 8,
  deliberately duplicated rather than a true shared module - see the
  file's own comment) exporting `reportError(err, context)`, called from
  every top-level `catch` block **and** every inline failure path that
  used to be a bare `console.error` with no other record - e.g. a Twilio
  send failing (`send-on-the-way-sms`, `run-automation-sms`), a Stripe
  subscription arriving with no `company_id` in its metadata
  (`stripe-webhook`), or a privacy-request notification email silently
  failing to send (`submit-data-request` — arguably the single
  highest-value report in this app, since that failure mode means a
  legally time-sensitive 30-day-deadline request goes completely unseen).
  The Stripe signature-verification failure in `stripe-webhook` is
  deliberately **not** reported — that's an expected security-boundary
  rejection (a replay, a misconfigured secret, a scanner probing the
  endpoint), not a bug.

### The Deno SDK's specific gotchas (why the edge function code looks the way it does)

Per [Supabase's own Sentry integration guide](https://supabase.com/docs/guides/functions/examples/sentry-monitoring):
- **`defaultIntegrations: false`** is required — the Deno SDK doesn't
  instrument this runtime, and Edge Function isolates can be reused
  across unrelated requests, so leaving default integrations on risks
  breadcrumbs/context leaking between different callers' requests.
- **`import * as Sentry from "npm:@sentry/deno@^8"`** is the exact
  specifier Supabase's own docs use — matches this codebase's existing
  convention of `npm:` specifiers for every other edge function
  dependency (`npm:stripe@17`, `npm:@supabase/supabase-js@2`).
- **Every capture needs an explicit `await Sentry.flush(2000)`** (wrapped
  inside `reportError`) — an Edge Function's isolate terminates
  immediately after the response is returned, so without a flush, a
  captured exception may never actually finish sending before the
  function tears down.
- **`tracesSampleRate: 0`** everywhere (frontend, backend, edge
  functions) — this is error tracking only, not full APM/performance
  monitoring, a deliberate scope decision matching what was actually
  asked for ("notified when something breaks," not "trace every
  request"). Turning on performance tracing later is just changing that
  one number per runtime.

**Verified**: after deploying, two of the updated Edge Functions
(`run-automation-sms`, `submit-data-request`) were smoke-tested live with
real `curl` requests and returned their expected `401`/`400` responses
rather than a boot error — confirming the new `npm:@sentry/deno@^8`
import resolves correctly at runtime even with no `SENTRY_DSN` set,
without needing an actual Sentry account to verify the deploy didn't
break anything.

### One-time setup

1. Create a free account at [sentry.io](https://sentry.io), then create
   **three projects** (one DSN per runtime — Sentry uses the project to
   group/route issues, so don't reuse one DSN everywhere): platform
   "React" for the dashboard, "Express" for `receptionist-server`, and
   "Deno" (or generic "Node") for the Edge Functions — a single DSN can
   be reused across all 8 functions.
2. **Frontend**: add `VITE_SENTRY_DSN` to your `.env` (see
   `.env.example`) and to your hosting provider's build-time environment
   variables (Vercel/Netlify/wherever this ends up deployed).
3. **`receptionist-server`**: add `SENTRY_DSN` to its `.env` / Render
   environment variables (see `receptionist-server/.env.example`).
4. **Edge Functions**: Supabase dashboard → Edge Functions → Secrets →
   add `SENTRY_DSN` once — it's a project-wide secret, so all 8 functions
   pick it up automatically, no per-function configuration.
5. **Set up alerts** (this is the actual "notify me immediately" part —
   Sentry capturing an error and Sentry *telling you* about it are two
   separate settings): in each Sentry project, **Alerts → Create Alert
   Rule**, trigger "A new issue is created," action "Send a notification"
   to email (and/or Slack, if you connect that integration). Sentry's
   default "someone assigned" style rules won't fire for a solo operator
   with nothing auto-assigned — the "new issue" trigger is the one that
   actually matches "tell me the first time this happens."

## Database backups & restore

Two layers, deliberately overlapping: Supabase's own managed backups (the
primary, fastest recovery path) and a supplementary off-platform dump via
GitHub Actions (the fallback for "the whole project/account is gone," not
just "someone fat-fingered a DELETE").

### Layer 1: Supabase's own Point-in-Time Recovery (PITR) — primary

This is the one to reach for first for almost any real incident (bad
migration, accidental delete, corrupted row) — it's faster and it covers
every schema, including `auth`.

- **Requires the Pro plan or higher**, plus at least the Small compute
  add-on. Retention is 7 days on Pro, 30 on Enterprise. If the project is
  still on the Free plan, there is **no backup/restore safety net at all**
  right now beyond Layer 2 below — upgrading is the single highest-value
  thing to do before this project has real customer data in it.
- **Enable it**: Supabase dashboard → **Database → Backups → Point in
  Time** → enable the PITR add-on.
- **Restore**: same page → pick a date/time within the retention window →
  **Start a restore** → review and confirm. Supabase downloads the latest
  physical backup, replays WAL up to that exact second, and swaps it in.
  **The project is inaccessible for the duration** — downtime scales with
  database size, so this is a "plan for it" operation, not an instant
  toggle. If anything in the project uses logical replication slots or
  subscriptions (this app doesn't, beyond what Realtime manages
  automatically), those need to be dropped before restoring and recreated
  after.

### Layer 2: nightly `pg_dump` via GitHub Actions — supplementary

`.github/workflows/db-backup.yml` — runs every night (`0 9 * * *` UTC,
cron `workflow_dispatch` also available for an on-demand run from the
Actions tab), dumps the `public` schema only (every real app table — jobs,
customers, automations, etc.) in Postgres custom format, and uploads it as
a workflow artifact with 90-day retention.

- Uses a `postgres:17` container image specifically so `pg_dump`'s version
  matches the server's (`get_project` reports `postgres_engine: "17"`) —
  an older client `pg_dump` can silently mis-handle newer server features.
- **Deliberately does not dump `auth`/`storage`/other Supabase-managed
  schemas.** Restoring those into a different project fights Supabase's
  own internal migrations for them. A full disaster-recovery restore of
  actual user accounts relies on Layer 1 (PITR) or, as a last resort,
  users re-registering with the same email — this workflow's job is
  making sure the actual *business data* survives even if Supabase itself
  is unreachable, not replacing PITR.
- **Required secret** (GitHub repo → Settings → Secrets and variables →
  Actions): `SUPABASE_DB_URL` — the direct Postgres connection string
  from Supabase dashboard → **Project Settings → Database → Connection
  string → URI** (use the direct connection, not the pooler in
  transaction mode — `pg_dump` needs a session-style connection).

**To restore from one of these dumps**:
1. Go to the workflow run in the **Actions** tab → download the
   `sable-db-backup-<run-id>` artifact → unzip it to get the
   `.dump` file.
2. **Strongly recommended: restore into a brand-new, empty Supabase
   project first** to verify the dump is good before touching anything
   real — create one via the dashboard (or the `create_project` tool),
   then:
   ```sh
   pg_restore --clean --if-exists --no-owner --no-privileges \
     -d "<new-project-connection-string>" \
     sable-2026-07-16.dump
   ```
3. Once verified, restoring into the *real* project the same way is
   destructive to whatever's currently there (`--clean` drops existing
   objects first) — only do this as an actual disaster-recovery step,
   ideally with Supabase support looped in, not as a routine operation.

## Automated tests (booking & payment flows)

**These were written and manually traced line-by-line against the actual
implementation, but never executed** — this dev environment has no
Node.js or Deno installed (consistent with every other piece of code in
this project; see the top of this file). The first real run will be
whichever comes first: `.github/workflows/test.yml` on the next push, or
your own machine. If anything doesn't compile/run cleanly, that's this
gap surfacing, not a sign the logic itself is wrong — see the manual
trace notes below for how each test was verified by hand.

### Why these two flows specifically

Booking and payment are the two paths in this app with **no human in the
loop watching for something to look wrong** — a bad quote or a mis-mapped
Stripe status doesn't throw an error a rep would notice, it just quietly
produces a wrong number that only surfaces when a customer complains. That
combination (silent + consequential) is exactly what automated tests are
for, and exactly why "basic" here still means testing the actual
branching logic, not just smoke-testing that a function runs.

### Booking flow — `receptionist-server` (Node's built-in test runner)

No new dependency — `node --test`, part of Node 18+, avoids adding a test
framework whose exact compatible version I'd otherwise be guessing at
blind. Run via `npm test` (receptionist-server/package.json → `"test":
"node --test test/"`).

- **`test/pricing.test.js`** — `calcQuote()` (lib/pricing.js). Locks in
  concrete dollar amounts (hand-verified against the formula, twice, after
  I caught my own arithmetic mistakes on the first pass — see below) for
  a couple of job-type/urgency/property/parts-tier combinations, plus
  relational invariants across every combination (low < high, urgency
  strictly increases price, commercial ≥ residential, parts tier
  ordering), and the two error paths (unknown job type/urgency).
- **`test/scheduling.test.js`** — `buildCandidates`/`resolveSlot`/
  `nextAvailableSlots` (lib/scheduling.js). Date-tolerant on purpose (no
  hardcoded calendar dates, since tests run on whatever day CI happens to
  run) — checks structural invariants instead: weekday-only candidates,
  no duplicate windows, a freeform label correctly resolving to `null`
  instead of throwing, and the slot-conflict filtering (a booked slot gets
  excluded, a *cancelled* job's old slot doesn't block a new one, another
  company's booking never blocks this company's availability).
- **`test/booking.test.js`** — `createBooking()` (lib/booking.js), the
  actual orchestration: new customer creation, reusing an existing
  customer matched by phone (no duplicate row), rejecting an
  already-booked structured slot, *not* rejecting a cancelled job's old
  slot, a freeform slot skipping the conflict check entirely, SMS consent
  only ever being recorded when explicitly `true` (never inferred), and
  picking up urgency/price from an existing `calls` row while marking it
  `booked`.
- **`test/fakeSupabase.js`** — a minimal in-memory stand-in for the slice
  of the supabase-js query-builder API this codebase actually uses
  (`.from/.select/.insert/.update/.eq/.neq/.in/.single/.maybeSingle`,
  implemented as a thenable so bare `await supabase.from(...).update(...)`
  calls with no terminal method still resolve). Not a general-purpose
  mock — just enough to exercise real branching logic without a live
  database.
- **Testability refactor**: `createBooking`, `nextAvailableSlots`, and
  the helpers they call now accept an optional `supabaseClient` parameter
  (default: the real client from `getSupabase()`) instead of calling
  `getSupabase()` internally. Purely additive — every existing call site
  in `server.js` is unchanged and still gets the real client — but it's
  what makes the fake-client tests above possible at all.

### Payment flow — Supabase Edge Functions (Deno's built-in test runner)

`deno test`, again zero new dependencies. Run via `deno test
supabase/functions/create-deposit-checkout/` and `deno test
supabase/functions/stripe-webhook/`.

- **Testability refactor**: both functions had their pure logic pulled
  out of `index.ts` into a same-directory module (`_pricing.ts`,
  `_billing.ts`) specifically because `index.ts` calls `Deno.serve(...)`
  at the top level — importing it for a test would start a real server as
  a side effect. The extracted modules have zero Deno API calls and zero
  Stripe/Supabase dependencies, so importing them for a test is inert.
- **`create-deposit-checkout/_pricing.test.ts`** — `calcDepositAmount`
  (must stay in sync with `src/dashboard/JobsBoard.jsx`'s independently-
  authored `depositAmount()` — nothing but this comment and both sides'
  tests enforces that, so if you change one, change the other) and
  `requiresDeposit`'s threshold logic.
- **`stripe-webhook/_billing.test.ts`** — `mapSubscriptionStatus` across
  every Stripe status this webhook can actually receive, plus a test that
  specifically asserts every mapped output is one of the 4 values the
  `subscriptions.status` check constraint actually allows (a status this
  function forgot to map would otherwise fail the DB write silently, with
  only a Sentry report — now at least present — to notice it happened).
  `periodEndOf`'s unix-seconds-to-ISO-string conversion and its
  missing-field-returns-null fallback.

**A real bug this pass caught before it shipped**: my first draft of the
deposit-amount test file had two hand-computed expected values wrong
(simple arithmetic slips — `Math.round` behavior on a couple of the test
inputs). Re-deriving each one very deliberately by hand (shown as
intermediate steps, not just the final number) caught both before they
were committed as *the assertions this suite would enforce for its own
first several examples*. That's the sharpest version of "make sure the
tests themselves aren't wrong" available without an actual runtime to
execute them against.

**Also caught while redeploying**: smoke-testing the refactored
`stripe-webhook` after redeploy returned a `500 WORKER_ERROR` on every
request — including a plain `GET` from a version deployed long before
today's changes (confirmed via `get_logs`). That rules out today's
`_billing.ts` extraction as the cause: `stripe-webhook` constructs its
Stripe client at module top level (`const stripe = new Stripe(...)`,
outside the request handler), and that throws immediately if
`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` aren't set as Edge Function
secrets yet — which, per the existing "One-time Stripe setup" steps under
"Deposit collection (Stripe)" above, they aren't. **This means the
deposit/subscription webhook is currently failing on every single
invocation** — harmless today since no real Stripe traffic is hitting it
yet, but worth knowing before it matters. It should resolve itself as
soon as those two secrets are configured; Sentry (now wired in) will
actually surface it going forward once `SENTRY_DSN` is set too.
`create-deposit-checkout` was separately confirmed *not* affected (its
Stripe client is constructed inside the request handler, not at module
scope) — smoke-tested to a clean `401` post-refactor.

### CI — the part that makes "must never silently break" actually true

`.github/workflows/test.yml` runs both suites on every push and PR to
`main`. Writing tests without running them automatically would just mean
a human has to remember to run `npm test`/`deno test` before every
deploy — this is the mechanism that removes that dependency on memory.

### What's deliberately not covered

- Express routing itself (`server.js`'s request/response wiring) — no
  `supertest` or similar HTTP-level harness. What's tested is the business
  logic those routes call, which is where an actual silent-wrong-number
  bug would live.
- Real Stripe API calls, real Twilio sends, real Supabase RLS enforcement
  — those remain covered by the manual verification approach used
  throughout this project (rolled-back transactional tests via
  `execute_sql` for anything RLS/DB-policy related), not by this test
  suite. This suite is specifically for the pure business-logic
  regressions that a manual one-off SQL check wouldn't catch on every
  future change.

## Schema reference

All tables are in `public`, RLS-enabled, scoped by `company_id`. Three
`SECURITY DEFINER` helper functions back the RLS policies:
`current_company_id()` and `current_role()` (resolving from the caller's
own `profiles` row, and returning `NULL` for `current_company_id()` if
that company is suspended/cancelled — see "Multi-tenancy guarantee"), and
`is_super_admin()` (resolving from `super_admins`, entirely separate from
`profiles` — see "Super-admin panel").

| Table | Purpose |
|---|---|
| `companies` | One row per tenant business; also holds pricing/ops settings (base fee, hourly rate, urgency multipliers, deposit rules, commission %, auto-assign/notify toggles) — the Settings page's "Pricing & Revenue" section. `status` (`trial`/`active`/`suspended`/`cancelled`) and `contact_email` are super-admin-managed (see "Super-admin panel"). |
| `profiles` | 1:1 with `auth.users`. `role` is `owner` or `tech` — never `super_admin`, which is a wholly separate table/identity, see below. |
| `job_types` | Per-company catalog of job types (drain, faucet, water heater, etc.), each with hours/rate/parts cost. |
| `customers` | CRM contacts, with referral code + who-referred-whom, SMS consent state (`sms_consent`/`_at`/`_method` — see "SMS consent & compliance"), and `pii_deleted_at` if their personal data has been anonymized (see "Terms of Service, Privacy Policy & data deletion requests"). |
| `jobs` | Core work orders: status (`unassigned → assigned → in_progress → done`/`cancelled`), assigned tech, urgency, price range, scheduling, and `source` (`manual`/`phone_ai`/`website_lead`). |
| `job_status_events` | Audit trail of status changes, with lat/lng for "checked in, location verified." |
| `tech_locations` | Latest lat/lng + status (`on_job`/`en_route`/`available`/`offline`) per tech — upsert target for the live map. |
| `time_entries` | Clock in/out. |
| `calls` | AI receptionist call log (quote, urgency, property/parts tier, outcome, transcript). Written by `receptionist-server` via the service role key. |
| `leads` | Marketing site lead form submissions. Written by the marketing site via the service role key. |
| `feedback` | Post-job sentiment; powers the owner's negative-feedback recovery alert. |
| `nurture_campaigns` / `campaign_enrollments` | Automated customer follow-up campaigns and who's enrolled. |
| `invoices` | Auto-generated on job completion. |
| `subscriptions` | Plan (FK to `plans.key`), status (`incomplete`/`active`/`past_due`/`canceled`), Stripe IDs — kept live by `stripe-webhook` for paid plans (see "Self-serve onboarding & billing") — plus `override_price`/`override_note` for a super-admin-set custom deal price (see "Super-admin panel"). |
| `integrations` | Connect-state for Google Calendar / QuickBooks / Slack / Stripe — schema only, no OAuth flows wired up yet. |
| `customer_interactions` | Notes/call-log timeline entries for a `customers` row. Append-only. |
| `automations` | No-code trigger → wait → action rules (see "Automation builder"). Owner-only read/write. |
| `automation_runs` | Delay queue for `automations` — one row per matching trigger event, executed by `run_due_automations()` on a `pg_cron` schedule. Owner-only read. |
| `sms_consent_events` | Append-only audit trail of every SMS consent change (see "SMS consent & compliance"). No update/delete policy — a consent record isn't evidence if it can be edited. |
| `data_deletion_requests` | Public GDPR/PIPEDA-style access/correction/deletion request intake from a company's marketing site (see "Terms of Service, Privacy Policy & data deletion requests"). Written only by the service role; not scoped to a single company the way every other table is. |
| `plans` | Platform-wide plan tiers (name, `monthly_price`, `features` jsonb array, `display_order`, `active`) — editable from the super-admin panel, no deploy required. Publicly readable when `active`; `subscriptions.plan` is a foreign key into this table's `key`. |
| `super_admins` | Platform-operator identities. `id` references `auth.users` but there is **no** `company_id` anywhere on this table or path to one — structurally outside the multi-tenant model (see "Super-admin panel"). |
| `admin_audit_log` | Append-only log of every super-admin action (who, what, target, timestamp). No insert/update/delete policy for any client role — rows are written only from inside the `admin_*` `SECURITY DEFINER` functions via `log_admin_action()`. |
| `revenue_snapshots` | One row per day (`snapshot_date` PK), written by a `pg_cron` job (`take_revenue_snapshot()`, nightly) — feeds the super-admin revenue chart with real history instead of a backfill that can't exist for a pre-launch product. |

### RLS pattern

- All company members can **read** everything scoped to their company
  (jobs, customers, calendar, team directory, etc.).
- **Owner-only writes**: `job_types`, `feedback`, `nurture_campaigns`,
  `campaign_enrollments`, `invoices`, `integrations`, company settings,
  team management.
- **Jobs**: owners can create/update/delete any job in their company; techs
  can update (status + notes) only jobs assigned to them.
- **`customers`**: any company member can create/update (owner or tech
  might add a new customer while booking on the spot).
- **`tech_locations` / `time_entries`**: techs write only their own row;
  everyone in the company can read (for the live map / team overview).
- **`calls` / `leads`**: read-only for company members via the API; all
  writes come from `receptionist-server` and the marketing site using the
  Supabase **service role key**, which bypasses RLS (there's no logged-in
  user on a phone call or an anonymous site visitor).

## Multi-tenancy guarantee

Every table that holds tenant data is scoped by `company_id` and RLS-enabled
— this was true from the very first migration, not bolted on later. What
migration `027_multitenancy_fk_hardening` (+ `028`, a same-day bugfix)
added was a deliberate audit pass specifically checking: *can one company
ever see or corrupt another company's data, even through a bug in the React
code, not just the intended UI flows?*

**Read isolation** (unchanged, already correct): every `SELECT` policy on
every table filters by `company_id = current_company_id()` — directly, or
via a join to a company-scoped parent for the two tables with no
`company_id` column of their own (`job_status_events` joins through
`jobs.company_id`; `campaign_enrollments` joins through
`nurture_campaigns.company_id`). `companies` itself is scoped by
`id = current_company_id()` instead, since it *is* the tenant. There is no
table, and no policy, that returns rows across a `company_id` boundary — a
client can send any query it wants (crafted, buggy, whatever) and Postgres
still only returns that session's own company's rows, because the
filtering happens in the database, not the app.

**Write-side gap this closed**: several `INSERT`/`UPDATE` `WITH CHECK`
clauses validated a row's *own* `company_id` but not that its foreign keys
(`jobs.customer_id`/`job_type_id`/`assigned_tech_id`/`call_id`,
`customers.referred_by`, `customer_interactions.customer_id`,
`campaign_enrollments.customer_id`) pointed at a row in that *same*
company. This never leaked another company's data (reads were always
independently re-scoped), but it meant a bug in the app's own dropdowns —
or a hand-crafted request — could link another company's row id into your
own data (e.g. a job "assigned" to a tech who doesn't work for you). Fixed
by adding `exists (select 1 from <referenced table> where id = <fk column>
and company_id = current_company_id())` to each affected policy's
`WITH CHECK`. Existing rows are untouched (`WITH CHECK` only applies to the
row image being written, not retroactively), and the migration confirmed
zero rows would have violated it (every table was empty at the time).

**Bug caught during this pass, worth knowing about if you write similar
policies later**: the first version of the `customers.referred_by` check
self-joined `customers` (aliased `c2`) to validate the referral target, and
wrote the condition as `c2.id = referred_by`. Because `c2` is itself
`customers`, the unqualified `referred_by` resolved to `c2.referred_by`
(the subquery's own column shadows the outer row), not the row being
inserted — so the check was actually comparing `c2.id = c2.referred_by`
and would have silently rejected almost every legitimate customer insert
that set a referral. Fixed one migration later
(`028_fix_customers_referred_by_check`) by qualifying the outer reference
explicitly (`customers.referred_by`). **Lesson**: any RLS policy that
self-joins a table to validate one of its own columns needs the outer
column reference qualified with the base table name — an unqualified
column name always resolves to the closest (innermost) matching table in
scope, not the policy's own row.

**How this was verified** (beyond reading the SQL): a rolled-back
transactional test (`begin; ... rollback;`, nothing committed) created two
throwaway companies/owners/customers and confirmed, live, that (a) Owner A
attempting to create a job pointed at Company B's `customer_id` gets
rejected with a real `42501 row-level security policy` error, and (b) the
equivalent same-company operations, including the `referred_by`
self-reference, succeed normally. `get_advisors` (security + performance)
was re-run after both migrations and shows no new findings.

**Suspension is the same guarantee, reused**: when the super-admin panel
suspends or cancels a company (see "Super-admin panel"),
`current_company_id()` was extended to return `NULL` for that company's
users instead of a real id. Because every company-scoped table's policies
already key off `company_id = current_company_id()`, this one change
instantly cuts off that company's access to every table, with no
per-table edits and no risk of missing one the way the write-side FK gap
above was missed the first time. Data is untouched — only access stops.

## Super-admin panel

A back-office tool for the platform operator (you) to manage every client
company on the platform — not a company-facing feature, and not reachable
by any company's owner or tech account, even by guessing a URL.

### Structural isolation, not just a permission check

`super_admins` is a standalone table (`id → auth.users`, `name`,
`created_at`) with **no `company_id` column and no path to one**. It's not
a row in `profiles` with a special role — `profiles.role` still only ever
allows `'owner'` or `'tech'`. This matters because every RLS policy in the
app is written in terms of `current_company_id()`/`current_role()`, both
of which read from `profiles`; a super admin simply has no `profiles` row,
so those policies never fire for them one way or the other. Admin access
runs entirely through a separate function, `is_super_admin()`:

```sql
create function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.super_admins where id = auth.uid())
$$;
```

Every `admin_*` RPC (company management, plan/pricing control, revenue,
audit log) starts with `if not public.is_super_admin() then raise
exception 'not authorized'; end if;` and is granted to `authenticated`
(not `anon`) — so an unauthenticated request never even reaches the check,
and a signed-in owner/tech gets a clean rejection with zero data returned,
no matter what they call.

### Frontend: a hard fork at the entry point, not a route

`main.jsx` checks `window.location.pathname.startsWith('/admin')` before
rendering anything and picks between two **completely separate** component
trees — `App.jsx` (the regular company dashboard, unauthenticated →
`LoginScreen`) or `admin/SuperAdminApp.jsx` (unauthenticated →
`admin/AdminLoginScreen.jsx`). There's no shared screen, no shared state
machine, and no code path that runs both. `SuperAdminApp` does its own
`supabase.auth.getSession()` check, then calls `is_super_admin()`; only a
`true` result renders `admin/AdminShell.jsx`. A regular owner signing in
at `/admin` (same Supabase Auth, since it's one project) just gets a
"Not authorized" screen — the session is real, but empty of admin rights.

**Deployment note**: since this is a plain pathname check with no server
framework, whatever static host serves the built app in production must
be configured to serve `index.html` for unknown paths (the standard SPA
rewrite) — otherwise `/admin` 404s at the host level before React ever
runs. `vite dev`/`vite preview` already do this automatically.

**Bootstrapping the first admin account**: there's no seed data and no
self-serve path to `super_admins` membership — `AdminLoginScreen.jsx` has
a "create one" option that runs the exact same `supabase.auth.signUp()`
as the regular app, which only creates an ordinary, privilege-less
`auth.users` row (harmless even if a stranger finds `/admin` and clicks
it — they still get "Not authorized" afterward). Granting real access is
a manual, one-time step: `insert into public.super_admins (id, name)
select id, 'Your Name' from auth.users where email = 'you@example.com';`

### Company management

- `admin_list_companies()` — every company + its plan/subscription status
  + live `tech_count`/`job_count`, for the list view.
- `admin_get_company_detail(company_id)` — one company's full detail:
  calls handled, jobs booked, technician count, and deposit revenue
  (`sum(jobs.deposit_amount) where deposit_status = 'paid'`), plus its
  plan, override price, and join code.
- `admin_create_company(name, contact_email, plan, trade)` — for hand
  onboarding: creates the `companies` + `subscriptions` rows and a join
  code, with **no owner profile yet** (there's no `auth.users` row to
  attach one to). The join code is handed to the real business owner, who
  redeems it like any employee would.
- `admin_set_company_status(company_id, status)` — `trial`/`active`/
  `suspended`/`cancelled`. Suspending or cancelling a company doesn't
  touch a single row of its data — see "Multi-tenancy guarantee" below for
  exactly how access gets cut.

**The join-code rename**: `join_company_as_tech` became `join_company` —
the first person to redeem a company's join code becomes its `owner`;
everyone after that becomes `tech`. A self-serve company (via
`create_company_and_owner`) already has its owner profile inserted before
any join code exists, so this never lets a tech displace an existing
owner — it only ever applies to a hand-onboarded company, which starts
with zero profiles.

### Pricing and plan control

- `plans` (see schema reference) is the single source of truth for tier
  name/price/features — `src/lib/plans.js`'s `listPlans()` reads it
  directly for the self-serve `PlanSelectionScreen`, so an admin price or
  feature-list change takes effect with no deploy.
- `admin_upsert_plan(key, name, monthly_price, features, display_order,
  active)` — create or edit a tier. `features` is a plain ordered JSON
  array of strings; add/remove/reorder in the admin UI just mutates that
  array and re-saves it, matching the plan editor's actual feature list
  (there's no deeper feature-gating enforcement elsewhere in the app today
  — see "Not built yet").
- `admin_reorder_plans(ordered_keys)` — bulk-sets `display_order`.
- `admin_delete_plan(key)` — blocked (`raise exception`) if any company is
  currently subscribed to it; deactivate (`active = false`) instead, which
  drops it from the signup screen without touching existing subscribers.
- `admin_set_company_override(company_id, override_price, note)` — a
  per-company custom price, independent of the standard tiers (early-
  customer discounts, hand-negotiated deals). `override_price = null`
  clears it and falls back to the plan's standard price. Every revenue
  calculation (`admin_revenue_overview`, `take_revenue_snapshot`) uses
  `coalesce(override_price, plan.monthly_price)`.

### Revenue overview

`admin_revenue_overview()` returns current MRR (sum of
`coalesce(override_price, monthly_price)` across `active`/`past_due`
subscriptions at non-suspended companies), a breakdown by plan, the full
`revenue_snapshots` history for the chart, and every company whose
subscription is `past_due` (surfaced as a flagged list, not just a number).

`revenue_snapshots` is filled by a `pg_cron` job
(`take-revenue-snapshot-daily`, 00:05 UTC) calling `take_revenue_snapshot()`
— same mechanism as `run-due-automations`. A pre-launch product has no
revenue history to backfill, so the chart starts as a single point on the
day this shipped and builds real history day by day; the frontend
(`admin/RevenuePage.jsx`) is a small dependency-free inline SVG line chart
rather than a charting library, since none was already in `package.json`.

### Audit log

Every `admin_*` mutation ends with `perform public.log_admin_action(...)`,
which inserts into `admin_audit_log` (super admin id, action, target
type/id, a `jsonb` details blob, timestamp). There is deliberately **no**
insert/update/delete grant on that table for any client-facing role —
`log_admin_action` itself has `execute` revoked from `public`/`anon`/
`authenticated`, so the only way a row is ever written is from inside
another `SECURITY DEFINER` admin function, which can't be bypassed from
the client. `admin_list_audit_log(limit)` is the read path.

**How this was verified**: a rolled-back transactional test (same pattern
as the multi-tenancy work) created a throwaway super admin, a hand-
onboarded company via `admin_create_company`, two joiners against its join
code (confirmed first → `owner`, second → `tech`), a plan upsert, a
company override, a status change to `suspended`, and confirmed
`current_company_id()` for that company's now-suspended owner flips from a
real UUID to `NULL` — plus confirmed a random non-admin authenticated user
calling `admin_list_companies()` gets rejected with `not authorized`. All
of it rolled back; nothing was left in the database.

## Trade-agnostic service catalog

The app was originally plumbing-only in three places: the hardcoded job
type list seeded at signup, the AI receptionist's system prompt, and the
marketing site's copy. All three now derive from a company's own trade and
service catalog instead.

**`trade_job_type_templates`** (migration 044) holds starter-catalog
defaults for five trades (Plumbing, Electrical, HVAC, Roofing, Locksmith),
`(trade, key)` primary key, publicly readable (not sensitive - it's the
same content as the onboarding plan comparison, not per-company data).
`create_company_and_owner` and `admin_create_company` both seed a new
company's `job_types` from this table for whatever trade was picked -
`OwnerOnboardingScreen.jsx`'s trade picker includes all five plus "Other"
(which seeds an empty catalog, same as any trade with no template). From
that point on the template is never referenced again - `job_types` is
fully independent, owner-editable data.

**Service Catalog page** (`src/dashboard/ServiceCatalogPage.jsx` +
`src/lib/jobTypes.js`, new "Services" tab in `AppShell.jsx`, owner-only)
is the "fully editable afterward" half of the requirement - add, edit,
retire/reactivate, and reprice any service. This is the *first* management
UI `job_types` has ever had; before this it could only be seeded once at
signup and never touched again. It writes directly against the existing
`job_types_insert/_update/_delete` RLS policies (owner + own company),
no new policies needed.

**AppShell branding**: `src/lib/tradeMeta.js` maps `companies.trade` to a
representative lucide icon (Wrench/Zap/Wind/Home/KeyRound, generic Hammer
fallback for an unrecognized trade), shown next to the company name in
`AppShell.jsx`'s header - the one "icon adapts to trade" touchpoint in the
dashboard chrome itself, since the rest of the dashboard (JobsBoard,
OwnerHome, ClientsPage) was already trade-neutral - it renders whatever
`job_types` says, with no hardcoded plumbing strings, and needed no changes
beyond finally having real per-trade data to render.

**receptionist-server** (single-tenant deployment, one instance per
company - see its README):
- `lib/pricing.js`'s `calcQuote` is now async and reads this company's own
  `job_types` (service catalog) and `companies` row (base fee, hourly
  rate, urgency multipliers) from Supabase instead of a hardcoded
  `JOB_TYPES` map - the same numbers the dashboard's Settings > Service
  Catalog page edits. `server.js`'s `get_quote` tool handler passes
  `companyId` and awaits it.
- `lib/assistantConfig.js`'s `buildAssistantConfig({ company, jobTypes,
  webhookUrl })` is a pure function that generates the full Vapi assistant
  definition (name, first message, system prompt, and the three tools'
  schemas) from a company's actual trade and active job types. The system
  prompt's "how to recognize an emergency without asking" clause pulls
  trade-appropriate cues from a small `EMERGENCY_CUES` map (flooding/burst
  pipes for Plumbing, sparking/exposed wires for Electrical, no heat/gas
  smell for HVAC, etc.), falling back to generic language for an
  unrecognized trade. An electrician's generated prompt has no path to
  ever mention "drain" - the job type list and emergency cues are both
  looked up by trade, there's no shared vocabulary to leak from. Throws if
  the catalog is empty rather than generating a broken assistant.
  `test/assistantConfig.test.js` asserts this directly (cross-trade term
  leakage, tool enum correctness, empty-catalog rejection).
- `generate-assistant.js` (CLI) replaces the old checked-in
  `vapi-assistant.json` (deleted - it was one hardcoded plumbing prompt
  for every deployment). Fetches the real company + active job types and
  prints a ready-to-upload assistant JSON. See README.md "Step 4."

**Marketing site**: `marketing-site.html` is now a template with
`{{TOKEN}}` placeholders (company name, location, hero copy, services
grid, testimonials, footer) instead of hardcoded Sable/Calgary/plumbing
content. `scripts/generate-marketing-site.js` (root-level, same resale
model as `generate-assistant.js` - one deployed site per company) fetches
a company's name/trade/service_area/active job types via the service role
key and fills in the template: a small `TRADE_CONTENT` map (keyed by
trade, generic fallback) supplies the hero headline/sub, services section
headline, final-CTA headline, and the "professional"/"emergency example"
words used in the (explicitly labeled placeholder) testimonials; the
services grid itself is generated directly from the company's real
`job_types` labels, not from the trade map. Writes
`marketing-site.generated.html` (gitignored - it's real business content
for one specific client, not a template to commit). Requires
`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_COMPANY_ID` in the
environment (see root `.env.example`); this script isn't part of the Vite
build, it runs standalone via `npm run generate-marketing-site`.

## Estimates & financing

A quote doesn't need to become a job to be worth tracking - the Estimates
tab (owner-only) exists specifically for the quote that never got a yes,
separate from the Jobs board's live tickets.

**`estimates`** (migration 051) is the single source of truth for every
quote, regardless of where it came from:

- **PickUp-sourced** (`source = 'phone_ai'`): `receptionist-server/lib/
  booking.js`'s `recordQuote()` upserts a row (keyed by `call_id`) every
  time `get_quote` runs, denormalizing `customer_phone` alongside the
  nullable `customer_id` FK - a caller who's quoted but never gives their
  name still gets a real estimate row with a phone number the Follow Up
  prompt can call/text, since a customer record is deliberately *not*
  created just from being quoted (only from actually booking). Re-quoting
  the same call (caller asks "what about X instead") updates the same row
  rather than creating a second one. When `createBooking()` succeeds,
  it marks the matching estimate `accepted` and sets its `job_id` - the
  quote-to-booking loop closes itself with no dashboard action needed.
- **Manual** (`source = 'manual'`): entered directly on the Estimates
  page (`src/dashboard/EstimatesPage.jsx`), reusing `findOrCreateCustomer`
  so a manual estimate always has a real `customer_id` from the start.

**Status** is one of `sent` / `viewed` / `accepted` / `declined`.
`sent` is automatic (set the moment an estimate is created - no customer
action required to reach it). The other three are **owner-set**, not
auto-detected - there's no customer-facing "view your estimate" link in
this app yet, so "Viewed" reflects what the owner learned from following
up, not a tracked click. Worth knowing before assuming more automation
exists than actually does.

**Follow Up (48 hours)**: `src/lib/estimates.js`'s `isStale()` flags any
estimate still sitting at `sent` more than 48 hours after `created_at`.
`EstimatesPage.jsx` surfaces these in a dedicated banner at the top of the
page (not just a badge buried in the list) with one-tap `tel:`/`sms:`
buttons (`callHref`/`textHref`) - these open the device's own phone/
messaging app with the customer's number, they don't send anything
automatically. No prefilled SMS body: iOS and Android disagree on whether
that's `?body=` or `&body=`, and silently dropping the param on one
platform felt worse than not trying.

**Convert to Job**: an accepted estimate with no `job_id` yet gets a
"Convert to Job" button, which calls `lib/jobs.js`'s `createJob` directly
(same insert every other booking path uses) pre-filled from the estimate's
price/job type/customer, then links `job_id` back. If the estimate has no
linked customer (a PickUp quote nobody ever gave a name for), the convert
flow collects one first via `findOrCreateCustomer` before creating the
job.

**Financing**: `companies.financing_enabled` / `financing_threshold`
(default $1,500) / `financing_partner_url` (Settings → Pricing & Revenue,
`SettingsPage.jsx`). When enabled, any estimate whose price clears the
threshold (`financingApplies()`) shows an "Ask about financing" note with
an outbound link to whatever partner the owner already has an account
with (Wisetack, Affirm, etc.) - this is a link-out, not a payment
integration; no partner API credentials are involved anywhere in this
app.

**Settings page** (`SettingsPage.jsx`) is new and currently holds only
the Pricing & Revenue section - the `companies` pricing columns (base
fee, hourly rate, urgency multipliers, deposit threshold/%, commission %)
existed since the very first schema pass but had no edit UI at all until
now. `AppShell.jsx` keeps a local, owner-updatable copy of the `company`
object (seeded from `profile.companies`) so a Settings save is reflected
immediately across every other tab in the same session, without a full
profile refetch.

## Tech inventory & recurring maintenance contracts

Migration 052 adds two unrelated-but-adjacent features requested together:
per-technician rough parts stock (feeds the Jobs board's assign picker),
and recurring maintenance contracts with automatic reminders.

**Parts & required parts** (`parts`, `job_type_parts`) - `parts` is a flat,
company-wide catalog (owner-only writes, managed from the Service Catalog
page's new "Parts Catalog" section, `ServiceCatalogPage.jsx`).
`job_type_parts` links a part to a job type (many-to-many) via the same
page's per-service "Required parts" toggle list
(`RequiredPartsPicker`) - `src/lib/inventory.js`'s `setJobTypeParts()`
does a full delete-and-reinsert per save rather than diffing, since this
is a small, infrequently-edited set.

**Per-tech stock** (`tech_part_stock`) - one row per (tech, part) with an
`in_stock` boolean, RLS-gated with the same "self or owner" pattern as
`tech_locations`/`time_entries` (a tech can edit their own row; an owner
can edit anyone's). A missing row means "not yet set," treated as in
stock by every reader (`listTechPartStockMap()`'s callers), matching the
column's own `default true`. Edited today only from the owner-facing
`src/dashboard/TeamPage.jsx` (new AppShell tab, between Services and
Winback) - there's no tech-facing profile screen yet (`TECH_TABS` is
still just Home + Calendar), so self-service editing isn't wired to any
screen even though RLS already allows it.

**Assign picker warning** (`JobsBoard.jsx`'s `AssignPicker`) - cross-
references a job's `job_type_id` against `job_type_parts` and every
candidate tech's `tech_part_stock` via `techsMissingParts()`
(`src/lib/inventory.js`). Shows an inline "Out of X, Y" warning under a
tech's name in the assign sheet. **Warns, never blocks** - the owner can
still tap to assign someone who's short a part (partial job, supply-store
run on the way, etc.).

**Service contracts** (`service_contracts`) - one row per recurring
agreement tied to a customer (e.g. "Annual Furnace Tune-Up", every 12
months, $189/visit), managed from `ContactDetailModal.jsx`'s new
"Maintenance Contracts" section (add / mark serviced / cancel). Owner-
only writes, FK-hardened to the caller's own `customers`.
`ClientsPage.jsx` shows each customer's soonest-due *active* contract
directly on their pipeline card (`NextContractDue`), colored by
`isOverdue`/`isDueSoon` (`src/lib/contracts.js`).

**Reminders**: `send_contract_reminders()` (SECURITY DEFINER, cron-only -
`EXECUTE` revoked from `public`/`anon`/`authenticated`) runs daily via
`cron.schedule('send-contract-reminders-daily', '0 14 * * *', ...)`. It
does *not* introduce a new delivery path - it selects contracts whose
`next_due_date <= current_date + reminder_lead_days` (default 14) and not
throttled by a recent `last_reminder_sent_at` (7-day cooldown), then calls
the exact same `run-automation-sms` edge function via `net.http_post` +
`vault.decrypted_secrets('automation_webhook_secret')` that
`run_due_automations()` (Winback) already uses - so contract reminders
automatically inherit SMS consent gating, the "Reply STOP" footer, and
Twilio 21610 → consent-revocation handling for free.

**`mark_contract_serviced(p_contract_id)`** (owner-only) rolls
`next_due_date` forward by `frequency_months` and clears
`last_reminder_sent_at`, so a serviced contract's reminder clock restarts
cleanly rather than firing again immediately or drifting from the
original schedule.

## Document Vault & last-visit summary

Migration 053 adds a per-customer document history plus a "what did we do
here last time" lookup for techs in the field, with no phone call to the
office required.

**Document Vault** (`src/dashboard/DocumentVaultModal.jsx`, opened from a
button in `ContactDetailModal.jsx`) merges three sources into one
newest-first scrollable list, per customer:

- **Invoices** (`invoices` table, already existed) - read-only here.
  Worth knowing: nothing in this app currently *writes* an invoice row
  (no invoice-generation UI exists yet), so in practice the vault's
  invoice section stays empty until that gap is closed separately - this
  feature only wires up the *read* side.
- **Job photos** (`job_photos`, new table + a private `job-photos`
  Storage bucket) - metadata (job, customer, caption, uploader) lives in
  Postgres; the bytes live in Storage, and every read goes through a
  60-minute signed URL (`src/lib/documents.js`'s `withSignedUrls()`),
  never a public one.
- **Warranty/workmanship notes** - reuse `customer_interactions` (same
  table backing the general Note/Call timeline in `ContactDetailModal`)
  with a new `type = 'warranty'` value (the check constraint was widened,
  not a new table) - `src/lib/documents.js`'s `addWarrantyNote()`/
  `listWarrantyNotesForCustomer()`.

**Storage RLS**: `job-photos` is private (`public: false`). Policies on
`storage.objects` mirror `job_photos`' own table RLS by parsing the
object path via `storage.foldername(name)` - the convention is
`{company_id}/{job_id}/{uuid}{ext}`, so `foldername(name)[1]` is checked
against `current_company_id()` and, for inserts, `foldername(name)[2]`
is checked against a job the caller is either the owner of the company
for or the `assigned_tech_id` on. This was verified with two rounds of
rolled-back SQL transaction tests - one on `public.job_photos`, one
inserting rows directly into `storage.objects` under different
impersonated users - since the two RLS surfaces (table + storage) are
independent and both need to agree. Note: `storage.objects` has a
`protect_delete()` trigger that blocks direct SQL `DELETE` entirely
(Supabase-managed) - deletion only works through the Storage API
(`src/lib/documents.js`'s `deleteJobPhoto()`), which is what the app
uses.

**Gotcha already hit once**: `job_photos.uploaded_by` needs `default
auth.uid()` - without it, an insert that doesn't explicitly pass
`uploaded_by` leaves it `NULL`, and the "uploader can delete their own
photo" RLS policy (`uploaded_by = auth.uid()`) then silently rejects
everyone, including the actual uploader, since `NULL = anything` is
never true in SQL. Caught during verification (migration `053b`), not
before.

**Where photos get uploaded**: `TechHome.jsx`'s `JobDetailModal` (a tech's
in-field job detail view) and `DocumentVaultModal.jsx` (owner side, picks
one of the customer's jobs from a dropdown since `job_id` is required).
Both call the same `uploadJobPhoto()` in `src/lib/documents.js`.

**Last-visit summary** (`TechHome.jsx`'s `JobDetailModal`, via
`getLastVisit()` in `src/lib/jobs.js`) - looks up the most recently
*completed* job for the same `customer_id`, excluding the job currently
open, and shows its date, job type, and notes in a small card right in
the detail view. Silently shows nothing for a first-time customer (no
prior completed job) rather than an empty state or error - this is
supplementary context, not something worth interrupting the job detail
screen over if the lookup is slow or fails.

## Notification center, monthly goals & technician leaderboard

Migration 054 (+ `054b`, a follow-up revoking EXECUTE on the four trigger
functions below for a clean security advisor) adds three requested-together
but architecturally separate pieces.

**Notification center** (`src/dashboard/NotificationCenterModal.jsx`,
opened from the bell icon in `AppShell.jsx`'s header, owner-only) replaces
the scattered per-page banners - OwnerHome's inline negative-feedback
banner, EstimatesPage's stale-estimate "Follow Up" banner - with one
reverse-chronological feed backed by a new `notifications` table.

- **Populated entirely server-side**, never by client code: four
  `SECURITY DEFINER` triggers (`notify_job_assigned`, `notify_deposit_paid`,
  `notify_invoice_paid`, `notify_negative_feedback`) plus a cron job
  (`flag_stale_estimates()`, scheduled every 6h via
  `cron.schedule('flag-stale-estimates-every-6h', ...)`, same shape as
  `send_contract_reminders()`). `notifications` has no INSERT policy for
  `authenticated` at all - rows only ever come from these
  privilege-bypassing functions, the same pattern already used for
  `mark_contract_serviced()`.
- **Types covered**: `job_assigned` (a tech gets assigned/reassigned),
  `payment_received` (a job's deposit is paid, or - forward-looking, see
  below - an invoice is marked paid), `negative_feedback` (a `feedback`
  row is inserted with `sentiment = 'negative'`), `estimate_stale` (an
  estimate has sat at `status = 'sent'` for 48+ hours, guarded against
  re-notifying the same estimate twice), and `review_left` - this last
  type exists in the check constraint for forward compatibility but
  **nothing populates it**: there's no Google review webhook/API
  integration in this app (the review-request flow only sends an
  outbound SMS with a link, see "Review-request SMS on job completion" -
  it has no way to know if a review actually landed). Flagged, not built.
- **`payment_received` is forward-looking on the invoice side**: the
  trigger on `invoices.status` transitioning to `'paid'` is real and
  tested, but (see "Not built yet") nothing currently writes an invoice
  row, so in practice today this notification type only ever fires from
  the `jobs.deposit_status` trigger. Free to have ready, same reasoning
  as the Document Vault's invoice read-side.
- **RLS**: `notifications_select`/`_update` are owner-only
  (`"current_role"() = 'owner'`) and company-scoped - a tech signed in
  gets an empty feed even though the bell button itself is already hidden
  for them client-side (`AppShell.jsx`'s `{isOwner && ...}` gate is a UX
  nicety, not the security boundary).
- **Bell badge** (`AppShell.jsx`) keeps its own lightweight unread count
  (`getUnreadNotificationCount()`, a `head: true` count query, not a full
  row fetch) live via `useTableRealtime('notifications', ...)`, so it
  updates even while the notification center itself is closed.
- **Bug caught during verification, not before**: an early version of
  the `id` uniqueness/positive-feedback test used a `feedback` insert
  without an explicit `company_id` - `feedback.company_id` has no
  column default (unlike most other tables' `default current_company_id()`),
  so the RLS `WITH CHECK` silently rejected it. Not a schema bug (nothing
  in the app relied on that default existing), just a test-writing
  mistake worth remembering for next time a `feedback` row needs
  inserting in a rolled-back test.

**Monthly goal & Analytics page** - `companies.goal_type` (`'revenue'` or
`'jobs'`, nullable) and `companies.goal_target` (numeric, nullable), set
from a new "Monthly Goal" card in `SettingsPage.jsx` (one goal at a time -
picking "No goal" clears both columns rather than leaving a stale target
around unused). Read by a brand-new `src/dashboard/AnalyticsPage.jsx`
(new `analytics` tab, owner-only) via `getMonthlyStats()` in
`src/lib/analytics.js`, which computes jobs-completed/revenue/avg-job-value
for the current calendar month from `jobs.price_high` in one query, then
derives goal progress from whichever of those two numbers `goal_type`
points at - so the goal bar and the supporting stat cards can never
disagree about what "this month" contains. **`app-demo.jsx`'s charted
"Insights" tab (revenue-over-time line, jobs-by-type bar) was not
ported** - `recharts` isn't a dependency of this app yet, and this
environment has no way to install a new package or verify its build
(no `npm`/`node` available), so adding it now would be an unverified
leap. `AnalyticsPage.jsx` intentionally starts lean: the goal bar plus
plain `StatCard`s, no charting library. Revisit if/when a real dev
environment can verify a `recharts` build.

**Technician leaderboard** (`TeamPage.jsx`, above the per-tech parts-stock
list) - jobs completed, average job value, and average time-to-complete
for the current calendar month, per tech, via
`listTechLeaderboardForMonth()` in `src/lib/analytics.js`. Time-to-complete
is `completed_at` (on `jobs`) minus the earliest `job_status_events` row
with `status = 'in_progress'` for that job - computed client-side from two
small queries rather than a DB view or function, since the per-company
monthly dataset is small and this keeps the aggregation logic visible
without a second SQL surface to maintain. A tech with zero completed jobs
this month still appears (zeros/dashes), so the leaderboard always
matches the roster above it rather than silently dropping someone.

**Bottom nav change**: 10 owner tabs (adding `team`, `analytics` this
session and last) no longer fit at equal-flex width on a phone screen, so
the tab bar now scrolls horizontally (`overflowX: 'auto'`, tabs pinned to
a fixed `62px` width) instead of squeezing every icon proportionally.

## Not built yet (flagged in the schema, not implemented)

> **Kept current as of the full system audit (migrations 065–070).** Items
> that USED to be here and are now built — Stripe billing webhooks +
> self-serve checkout (`stripe-webhook`, `create-subscription-checkout`,
> `change-subscription-plan`), self-serve cancellation, team-member removal
> (`owner_remove_team_member`, TeamPage), the no-login customer portal
> (`portal.html` + `job-status`), the outage voicemail fallback, and
> warranty-callback tracking — have been removed from this list. The app is
> wired to Supabase (the old `app-demo.jsx` in-memory note is gone).

- **Invoice generation — still not built (audit I5).** The `invoices` table,
  the Document Vault's read side, and the customer portal's invoice section
  all exist, but nothing writes an invoice row yet, so all three render
  empty for a completed job. Blocked on two decisions: the amount source (an
  estimate range is not a final total) and the `invoices.status` check-
  constraint values. Auto-generating a financial document from an estimate
  was deliberately NOT shipped blind.
- **Per-feature plan gating (audit I1).** Only the Fleet-tier multi-location
  switcher is plan-gated (`plan === 'pro'`, enforced in AppShell/Settings).
  Everything else the marketing tiers list (CRM, live map, dispatch) is
  included in *all* tiers, so there is intentionally nothing else to gate;
  `plans.features` remains display-only. If a future tier removes a feature,
  add the entitlement check then.
- Google review ingestion - `review_left` notification type exists but no
  Google Business Profile API/webhook detects a real review landing.
- Charted analytics - `recharts` still not a dependency; `AnalyticsPage.jsx`
  is the goal bar + stat cards only.
- Google Calendar / QuickBooks / Slack OAuth (integrations table exists,
  `connected` stays `false`; the marketing Integrations page is aspirational).
- Apple sign-in - only email/password + Google are implemented (audit I6).
  No in-product surface claims Apple; add the provider before advertising it.
- Setup fee collection - the $1,000–$2,000 onboarding fee is advertised but
  not charged by `create-subscription-checkout` (only the recurring plan +
  7-day trial are). Collected manually at hand-onboarding today.
- A customer-facing "view your estimate" link/portal — the Estimates
  page's "Viewed" status is owner-set, not auto-detected from a real
  customer click, because that page doesn't exist. Building it (a public
  token-based estimate view + a status-update write) would be the natural
  next step if "Viewed" needs to mean something more than "the owner
  marked it viewed."
- A dedicated Team/General/Integrations section on the Settings page -
  only Pricing & Revenue exists so far.
- Stripe `Price` syncing for admin-edited plan prices — `admin_upsert_plan`
  has a `stripe_price_id` column to fill in, but changing `monthly_price`
  in the admin panel doesn't push anything to Stripe; a paid plan's actual
  charge still comes from whatever Stripe Price the `STRIPE_PRICE_GROWTH`/
  `STRIPE_PRICE_PRO` edge function secrets point at.
- A tech-facing profile screen — `tech_part_stock` RLS already lets a tech
  edit their own stock rows, but `TECH_TABS` is still just Home + Calendar,
  so in practice only the owner (via `TeamPage.jsx`) edits anyone's stock
  today.
- Team member management (invite link display, regenerate join code,
  remove a team member) has no owner-facing screen — `regenerate_join_code`
  exists as an RPC but nothing in the dashboard calls it yet. `TeamPage.jsx`
  is scoped to parts stock only, not member administration.
