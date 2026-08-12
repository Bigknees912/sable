import { createClient } from "npm:@supabase/supabase-js@2";
import { reportError } from "./_sentry.ts";
import { timingSafeEqual } from "./_timingSafeEqual.ts";

// Called by the jobs_started_send_on_the_way DB trigger (migration
// 017_on_the_way_sms_on_job_started) the instant a job's status becomes
// 'in_progress' - i.e. when a tech taps "Start Job". Not called by any
// client directly. verify_jwt is off (set at deploy time) because the
// trigger has no Supabase user session; the x-webhook-secret header
// checked below IS the authentication.
//
// "Live Google Maps link" here means an interactive maps.google.com URL
// to the job address (same URL TechHome's own "Navigate" button uses) -
// not real-time GPS tracking of the tech. There's no location pipeline
// (tech_locations has no GPS source wired up), so this doesn't pretend to
// show where the tech actually is, only where they're headed.
//
// SMS consent gate (migration 032_sms_consent, see AUTH.md "SMS consent &
// compliance"): skips gracefully - same as the existing "no phone on
// file" check - if the customer hasn't consented. If Twilio reports the
// number opted out via STOP (error 21610), that's synced back to our own
// customers.sms_consent so later attempts short-circuit here instead of
// hitting Twilio again.

Deno.serve(async (req) => {
  try {
    const providedSecret = req.headers.get("x-webhook-secret");
    const expectedSecret = Deno.env.get("JOB_STARTED_WEBHOOK_SECRET");
    if (!providedSecret || !expectedSecret || !timingSafeEqual(providedSecret, expectedSecret)) {
      return new Response("unauthorized", { status: 401 });
    }

    const { job_id } = await req.json();
    if (!job_id) return new Response("job_id is required", { status: 400 });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("id, status, address, company_id, portal_token, customers(id, name, phone, sms_consent), companies(name), assigned_tech:profiles!jobs_assigned_tech_id_fkey(name)")
      .eq("id", job_id)
      .maybeSingle();
    if (jobError) throw jobError;

    if (!job || job.status !== "in_progress") {
      return json({ skipped: "job not found or not in_progress" });
    }

    const customer = job.customers as unknown as { id: string; name: string; phone: string | null; sms_consent: boolean } | null;
    const company = job.companies as unknown as { name: string };
    const tech = job.assigned_tech as unknown as { name: string } | null;

    const toNumber = customer?.phone ? toE164(customer.phone) : null;
    if (!toNumber) {
      return json({ skipped: "no usable phone number on file for this customer" });
    }
    if (!customer?.sms_consent) {
      return json({ skipped: "customer has not consented to SMS" });
    }

    const firstName = customer.name?.trim().split(/\s+/)[0] || "there";
    const techFirstName = tech?.name?.trim().split(/\s+/)[0] || "Your technician";
    const mapsLink = `https://maps.google.com/?q=${encodeURIComponent(job.address)}`;
    // No-login customer portal link (task 2). PORTAL_BASE_URL is the public
    // marketing/app domain that serves portal.html (e.g. https://runsable.com).
    // Omitted from the text if unset rather than sending a broken link.
    const portalBase = Deno.env.get("PORTAL_BASE_URL");
    const portalToken = (job as unknown as { portal_token?: string }).portal_token;
    const trackLink = portalBase && portalToken ? ` Track your visit: ${portalBase.replace(/\/$/, "")}/portal.html?t=${portalToken}` : "";
    const message = `Hi ${firstName}, ${techFirstName} from ${company.name} is on the way to ${job.address}. ${mapsLink}${trackLink} Reply STOP to opt out.`;

    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN")!;
    const fromNumber = Deno.env.get("TWILIO_FROM_NUMBER")!;

    const twilioResp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: toNumber, From: fromNumber, Body: message }),
    });

    if (!twilioResp.ok) {
      const errText = await twilioResp.text();
      await recordOptOutIfApplicable(supabase, customer.id, job.company_id, errText);
      await reportError(new Error(`Twilio send failed: ${twilioResp.status} ${errText}`), { function: "send-on-the-way-sms", jobId: job.id });
      return json({ sent: false, error: errText }, 502);
    }

    return json({ sent: true });
  } catch (err) {
    await reportError(err, { function: "send-on-the-way-sms" });
    return json({ error: err instanceof Error ? err.message : "internal error" }, 500);
  }
});

// Twilio requires E.164 (+15551234567). Duplicated from
// send-review-request's copy - each edge function is deployed as an
// independent file tree, and this is a 6-line helper, not worth wiring
// cross-function imports for.
function toE164(raw: string): string | null {
  if (raw.trim().startsWith("+")) return raw.trim();
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

// Twilio error 21610 means the recipient has previously replied STOP -
// Twilio already blocks the send at the carrier level regardless of what
// we do here, but without this our own sms_consent flag would stay stale
// (true) forever, so every future automation/trigger would keep trying
// and keep failing silently. Best-effort: a failure here shouldn't shadow
// the original Twilio error already being returned to the caller.
async function recordOptOutIfApplicable(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  customerId: string,
  companyId: string,
  twilioErrText: string
) {
  try {
    const parsed = JSON.parse(twilioErrText);
    if (parsed?.code !== 21610) return;
    await supabase
      .from("customers")
      .update({ sms_consent: false, sms_consent_at: new Date().toISOString(), sms_consent_method: "twilio_opt_out_keyword" })
      .eq("id", customerId);
    await supabase.from("sms_consent_events").insert({
      company_id: companyId,
      customer_id: customerId,
      consent: false,
      method: "twilio_opt_out_keyword",
      note: "Twilio blocked send: recipient previously replied STOP (error 21610)",
    });
  } catch (err) {
    console.error("Failed to record opt-out from Twilio 21610:", err instanceof Error ? err.message : err);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
