import { createClient } from "npm:@supabase/supabase-js@2";
import { reportError } from "./_sentry.ts";
import { timingSafeEqual } from "./_timingSafeEqual.ts";

// Task 1: voicemail fallback behind the AI receptionist.
//
// When Vapi or the receptionist webhook is unreachable/erroring, the call
// is routed at the Vapi phone-number level to a recorded voicemail (see
// receptionist-server/README "Outage safety net"). Twilio's voicemail
// TwiML (a <Record> with recordingStatusCallback / transcribeCallback)
// POSTs the result here. This lands it as a real New Lead - flagged
// capture_method='fallback_voicemail' so it is never confused with a
// normal AI-handled call - and fires a monitoring alert so the operator
// hears about the outage before a client does.
//
// verify_jwt is OFF (set at deploy time): the caller is Twilio's servers,
// not a logged-in Supabase user, so the x-webhook-secret header IS the
// authentication. Same pattern as send-on-the-way-sms.

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  try {
    const providedSecret = req.headers.get("x-webhook-secret");
    const expectedSecret = Deno.env.get("FALLBACK_VOICEMAIL_WEBHOOK_SECRET");
    if (!providedSecret || !expectedSecret || !timingSafeEqual(providedSecret, expectedSecret)) {
      return new Response("unauthorized", { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const companyId = typeof body.companyId === "string" ? body.companyId : Deno.env.get("SUPABASE_COMPANY_ID");
    if (!companyId) return json({ error: "companyId is required" }, 400);

    const callerPhone = normalizePhone(body.callerPhone || body.from || body.From);
    const callerName = typeof body.callerName === "string" ? body.callerName.slice(0, 120) : null;
    const transcription = typeof body.transcription === "string" ? body.transcription.slice(0, 4000)
      : typeof body.TranscriptionText === "string" ? body.TranscriptionText.slice(0, 4000) : null;
    const recordingUrl = typeof body.recordingUrl === "string" ? body.recordingUrl
      : typeof body.RecordingUrl === "string" ? body.RecordingUrl : null;
    const vapiCallId = typeof body.vapiCallId === "string" ? body.vapiCallId : null;

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Find or create the customer, at new_lead, flagged as a fallback capture.
    let customerId: string | null = null;
    if (callerPhone) {
      const { data: existing } = await supabase
        .from("customers")
        .select("id")
        .eq("company_id", companyId)
        .eq("phone", callerPhone)
        .maybeSingle();
      customerId = existing?.id ?? null;
    }
    if (!customerId) {
      const { data: created, error: createErr } = await supabase
        .from("customers")
        .insert({
          company_id: companyId,
          name: callerName || "Voicemail caller",
          phone: callerPhone,
          pipeline_stage: "new_lead",
          capture_method: "fallback_voicemail",
        })
        .select("id")
        .single();
      if (createErr) throw createErr;
      customerId = created.id;
    } else {
      // An existing contact who reached the fallback still gets flagged, so
      // the owner sees this particular interaction came in during an outage.
      await supabase.from("customers").update({ capture_method: "fallback_voicemail" }).eq("id", customerId);
    }

    // Record the call itself as outcome 'voicemail' so it shows on call
    // history distinct from abandoned/quoted/booked/transferred.
    await supabase.from("calls").insert({
      company_id: companyId,
      vapi_call_id: vapiCallId,
      customer_id: customerId,
      customer_phone: callerPhone,
      customer_name: callerName,
      outcome: "voicemail",
      transcript: transcription ? { fallback_voicemail: transcription, recording_url: recordingUrl } : null,
      ended_at: new Date().toISOString(),
    });

    // Human-readable note in the CRM interaction feed.
    await supabase.from("customer_interactions").insert({
      company_id: companyId,
      customer_id: customerId,
      type: "call",
      body: `Captured via fallback voicemail during a receptionist outage. ${transcription ? `Message: "${transcription}"` : "No transcription available."}${recordingUrl ? ` Recording: ${recordingUrl}` : ""} Call this lead back within the hour.`,
    });

    // Fire the monitoring alert - a fallback voicemail means the AI path
    // failed for this call, which is exactly the outage the operator needs
    // to know about immediately. Reuses the outage-alert endpoint if
    // configured; non-fatal either way (the lead is already saved).
    fireOutageAlert(companyId, callerPhone).catch((e) =>
      console.error("fallback monitoring alert failed (non-fatal):", e instanceof Error ? e.message : e)
    );

    return json({ received: true, customerId });
  } catch (err) {
    await reportError(err, { function: "fallback-voicemail" });
    return json({ error: err instanceof Error ? err.message : "internal error" }, 500);
  }
});

async function fireOutageAlert(companyId: string, callerPhone: string | null) {
  const url = Deno.env.get("OUTAGE_ALERT_URL");
  const secret = Deno.env.get("OUTAGE_ALERT_WEBHOOK_SECRET");
  if (!url || !secret) {
    console.error(`FALLBACK VOICEMAIL TRIGGERED for company ${companyId} (caller ${callerPhone || "unknown"}) - AI receptionist path failed. Set OUTAGE_ALERT_URL to get notified in real time.`);
    return;
  }
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-secret": secret },
    body: JSON.stringify({
      companyId,
      failureCount: 1,
      lastError: `Fallback voicemail triggered - a caller (${callerPhone || "unknown"}) reached voicemail because the AI receptionist was unreachable.`,
    }),
  });
  if (!resp.ok) throw new Error(`outage alert endpoint returned ${resp.status}`);
}

function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  if (raw.trim().startsWith("+")) return raw.trim();
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return raw.trim();
}
