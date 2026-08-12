import { createClient } from "npm:@supabase/supabase-js@2";
import { reportError } from "./_sentry.ts";
import { timingSafeEqual } from "./_timingSafeEqual.ts";

// Called by receptionist-server's outage circuit breaker (see
// receptionist-server/lib/outageAlert.js) once a company's Alex deployment
// has hit several tool-call failures in a short window - i.e. this looks
// like an outage, not one bad request. verify_jwt is off (set at deploy
// time), same reasoning as send-on-the-way-sms: the caller here is our own
// backend process, not a logged-in Supabase user, so the x-webhook-secret
// header IS the authentication.
//
// Texts the company's owner directly so they hear about a problem with
// "never miss a call" from us, within minutes, instead of from a customer
// days later - and logs the alert so it shows up as a real record, not
// just a text message that might get missed or deleted.

Deno.serve(async (req) => {
  try {
    const providedSecret = req.headers.get("x-webhook-secret");
    const expectedSecret = Deno.env.get("OUTAGE_ALERT_WEBHOOK_SECRET");
    if (!providedSecret || !expectedSecret || !timingSafeEqual(providedSecret, expectedSecret)) {
      return new Response("unauthorized", { status: 401 });
    }

    const { companyId, failureCount, lastError } = await req.json();
    if (!companyId) return json({ error: "companyId is required" }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: company } = await supabase.from("companies").select("name").eq("id", companyId).maybeSingle();
    const { data: owner } = await supabase
      .from("profiles")
      .select("phone")
      .eq("company_id", companyId)
      .eq("role", "owner")
      .maybeSingle();

    await supabase.from("receptionist_outage_alerts").insert({
      company_id: companyId,
      failure_count: typeof failureCount === "number" ? failureCount : 0,
      last_error: typeof lastError === "string" ? lastError.slice(0, 500) : null,
    });

    const toNumber = owner?.phone ? toE164(owner.phone) : null;
    let notified = false;
    if (toNumber) {
      const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
      const authToken = Deno.env.get("TWILIO_AUTH_TOKEN")!;
      const fromNumber = Deno.env.get("TWILIO_FROM_NUMBER")!;
      const message = `Sable alert: Alex (your AI receptionist for ${company?.name || "your business"}) just hit ${failureCount ?? "several"} errors in a few minutes and may be missing calls right now. Keep an eye on your phone line as backup - we're already on it.`;

      const twilioResp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: toNumber, From: fromNumber, Body: message }),
      });

      if (twilioResp.ok) {
        notified = true;
      } else {
        const errText = await twilioResp.text();
        await reportError(new Error(`Twilio outage-alert send failed: ${twilioResp.status} ${errText}`), { function: "receptionist-outage-alert", companyId });
      }
    } else {
      // No owner phone on file - still logged above, and this itself is
      // worth knowing about (the safety net has no number to call).
      await reportError(new Error("outage alert: no owner phone on file to notify"), { function: "receptionist-outage-alert", companyId });
    }

    return json({ received: true, notified });
  } catch (err) {
    await reportError(err, { function: "receptionist-outage-alert" });
    return json({ error: err instanceof Error ? err.message : "internal error" }, 500);
  }
});

// Twilio requires E.164 (+15551234567). Duplicated from
// send-on-the-way-sms's copy - each edge function is deployed as an
// independent file tree, and this is a 6-line helper, not worth wiring
// cross-function imports for.
function toE164(raw: string): string | null {
  if (raw.trim().startsWith("+")) return raw.trim();
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
