// In-memory circuit breaker on top of the per-tool-call try/catch in
// server.js. One failed tool call is a blip - three in five minutes for
// the same company looks like an outage (Supabase down, Twilio down, a bad
// deploy), and that's exactly the scenario where "you never miss a call"
// silently stops being true. This fires an urgent alert to the company's
// owner the moment that pattern shows up, instead of the client finding
// out days later from an angry customer who never got called back.
//
// Deliberately in-memory, not a DB table: this only needs to survive a
// single process's uptime to catch a live outage as it's happening. A
// process restart resetting the counter is fine - a fresh process
// re-detects a still-ongoing outage within the same 5-minute window anyway.
const WINDOW_MS = 5 * 60 * 1000;
const FAILURE_THRESHOLD = 3;
const ALERT_COOLDOWN_MS = 15 * 60 * 1000; // don't re-text the owner every failure once they've been told

const failuresByCompany = new Map(); // companyId -> timestamps[]
const lastAlertByCompany = new Map(); // companyId -> timestamp

function recordFailureAndMaybeAlert(companyId, err, context) {
  if (!companyId) return;
  const now = Date.now();
  const timestamps = (failuresByCompany.get(companyId) || []).filter((t) => now - t < WINDOW_MS);
  timestamps.push(now);
  failuresByCompany.set(companyId, timestamps);

  if (timestamps.length < FAILURE_THRESHOLD) return;
  const lastAlert = lastAlertByCompany.get(companyId) || 0;
  if (now - lastAlert < ALERT_COOLDOWN_MS) return;
  lastAlertByCompany.set(companyId, now);

  sendOutageAlert(companyId, { failureCount: timestamps.length, lastError: err?.message || "unknown error", context }).catch((alertErr) => {
    console.error("outage alert failed to send (non-fatal - the call itself is unaffected):", alertErr.message);
  });
}

async function sendOutageAlert(companyId, detail) {
  const url = process.env.OUTAGE_ALERT_URL;
  const secret = process.env.OUTAGE_ALERT_WEBHOOK_SECRET;
  if (!url || !secret) {
    // Not configured yet - still surface it loudly in logs/Sentry (server.js
    // already reports the underlying error) so this isn't a silent gap.
    console.error(`OUTAGE ALERT NOT SENT (set OUTAGE_ALERT_URL/OUTAGE_ALERT_WEBHOOK_SECRET to enable): company ${companyId} had ${detail.failureCount} receptionist failures in the last 5 minutes. Last error: ${detail.lastError}`);
    return;
  }
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-secret": secret },
    body: JSON.stringify({ companyId, ...detail }),
  });
  if (!resp.ok) throw new Error(`outage alert endpoint returned ${resp.status}`);
}

module.exports = { recordFailureAndMaybeAlert };
