# Sable — Everything

## Done

**Repo**
- [x] GitHub repo `Bigknees912/sable` (renamed from `mayfield-plumbing`)
- [x] PR #2 merged into `main`

**Frontend**
- [x] Vite multi-page build, 17 static pages + React dashboard
- [x] Clean production build, no errors
- [x] New copper design across all marketing pages
- [x] No horizontal overflow on any page at phone width
- [x] Portal renders cleanly on phone
- [x] Dashboard built phone-first (narrow centered columns)
- [x] WCAG contrast fixes
- [x] Focus-visible styles everywhere
- [x] Keyboard-trap fixes, Escape-to-close on modals
- [x] Label/htmlFor associations, icon aria-labels
- [x] Accessibility-tree check passed

**Database**
- [x] 78 migrations applied to live project
- [x] Multi-tenancy + RLS on tenant tables
- [x] No RLS-disabled or missing-policy findings
- [x] Admin functions guarded internally

**Backend**
- [x] 13 edge functions deployed and active
- [x] Correct auth settings on all of them
- [x] Stripe plans created with 7-day trial wired in
- [x] Voice receptionist: interruption handling, callback detection, outage fallback
- [x] Genericized across trades

**Automations**
- [x] n8n workflow suite built (leads, appointments, feedback, dispatch, invoicing, dunning)

**Security**
- [x] Auth hardening: trigger lockdown, join-code lifecycle, tenant indexes

---

## Still To Do

**Before selling**
- [ ] Run one company through end-to-end (signup → job → completion → portal link)
- [ ] Set the Vercel environment variables
- [ ] Confirm Stripe checkout works in live mode
- [ ] Set the edge-function secrets (portal URL, webhook secrets)
- [ ] Set up the phone number (Vapi + Twilio + voicemail fallback)

**Portal**
- [ ] Add a "call the business" phone link
- [ ] Make it auto-refresh
- [ ] Decide white-label: show the plumber's brand instead of Sable's

**Automations**
- [ ] Import workflows into a running n8n instance and connect credentials

**Polish**
- [ ] Fix the CSP header (currently in the wrong place, doesn't work)
- [ ] Bump small tap targets and tiny text for mobile
- [ ] Test the logged-in dashboard on a real phone
- [ ] Unify the two legal pages to match the main color
- [ ] Point a real domain, confirm production looks right

**New setup**
- [ ] `npm install`, copy `.env.example` to `.env`, `npm run build`
