const crypto = require("crypto");
const Sentry = require("./instrument"); // must load before anything else - see instrument.js
const express = require("express");
const { calcQuote } = require("./lib/pricing");
const { nextAvailableSlots } = require("./lib/scheduling");
const { recordQuote, createBooking, findOrCreateLeadForCall, escalateToHuman, logSystemErrorForFollowup } = require("./lib/booking");
const { getCompanyId, getSupabase, validateEnv } = require("./lib/supabase");
const { validateBookingArgs, validateQuoteArgs } = require("./lib/validate");
const { isRateLimited } = require("./lib/rateLimiter");
const { recordFailureAndMaybeAlert } = require("./lib/outageAlert");

// Fail loudly at boot if Supabase env vars are missing, instead of only
// discovering it on the first real phone call.
validateEnv();

const app = express();
app.use(express.json());

// Shared-secret check, now required rather than optional: this endpoint
// creates real jobs/customers and can trigger real SMS spend, so "forgot
// to set the secret" must fail closed (reject everything, loudly, in the
// logs) instead of silently accepting unauthenticated traffic. Set
// VAPI_WEBHOOK_SECRET in your environment and add the same value as a
// header in Vapi's tool "server" config (Custom Credentials -> pass it as
// an Authorization header).
function checkAuth(req, res, next) {
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  if (!secret) {
    console.error("VAPI_WEBHOOK_SECRET is not set - refusing all webhook traffic. Set it before going live (see README's 'Things to tighten').");
    return res.status(503).json({ error: "webhook not configured" });
  }
  const header = req.headers["authorization"] || "";
  const expected = `Bearer ${secret}`;
  // Constant-time comparison - a plain === leaks timing information an
  // attacker could in principle use to guess the secret byte-by-byte.
  const headerBuf = Buffer.from(header);
  const expectedBuf = Buffer.from(expected);
  const matches = headerBuf.length === expectedBuf.length && crypto.timingSafeEqual(headerBuf, expectedBuf);
  if (matches) return next();
  return res.status(401).json({ error: "unauthorized" });
}

// Rate limits, keyed by the caller's phone number (not IP - every request
// here comes from Vapi's own servers, not the end caller, so an IP-based
// limit would throttle every caller on this deployment together instead
// of isolating a single abusive one). Falls back to the Vapi call id, and
// finally to a shared bucket, for the rare case neither is available.
const RATE_LIMITS = {
  book_appointment: { windowMs: 60 * 60 * 1000, max: 3 }, // 3 bookings/hour/caller
  get_quote: { windowMs: 10 * 60 * 1000, max: 15 }, // 15 quotes/10min/caller
  default: { windowMs: 10 * 60 * 1000, max: 40 }, // blanket ceiling on any tool/caller
};

function rateLimitKey(toolName, callContext) {
  const caller = callContext.customerPhone || callContext.vapiCallId || "unknown-caller";
  return `${toolName}:${caller}`;
}

// Vapi sends every tool call for the assistant to this one endpoint, batched
// as toolCallList, alongside call metadata (id, caller's number) under
// message.call. That shape is per Vapi's documented server-message format -
// worth double-checking against a real call's payload (e.g. via get_logs)
// the first time you test this live, since it's untested against an actual
// call from this end. Vapi also sends other message.type values to this
// same URL (status updates, an end-of-call report with the full
// transcript) - handled below, but the exact field names/shape are equally
// unverified against a real call and worth confirming the same way.
app.post("/vapi/webhook", checkAuth, async (req, res) => {
  const message = req.body?.message || {};
  const call = message.call || {};
  // The variant tag baked into this deployment's own webhook URL by
  // generate-assistant.js (?variant=a|b) - not per-call from Vapi, since
  // an inbound call has no opinion on which prompt variant it got, the
  // deployment does. Read once per request; cheap enough not to cache.
  const promptVariant = typeof req.query.variant === "string" ? req.query.variant : null;
  const callContext = { vapiCallId: call.id, customerPhone: call.customer?.number, customerName: call.customer?.name };

  if (message.type === "end-of-call-report") {
    await handleEndOfCallReport(message, callContext);
    return res.json({ received: true });
  }

  // Best-effort "call started" signal - creates the lead the instant we
  // know who's calling, so a caller who never triggers get_quote (asks
  // something out of scope, or just hangs up) still shows up as a
  // new_lead. If this message.type guess is wrong for your Vapi account,
  // the get_quote/escalate_to_human paths in runTool() still create the
  // lead on first tool call either way - this is strictly earlier, not the
  // only path.
  if (message.type === "status-update" && message.status === "in-progress" && callContext.vapiCallId) {
    findOrCreateLeadForCall({ companyId: getCompanyId(), ...callContext, promptVariant })
      .catch((err) => console.error("call-start lead capture failed (non-fatal):", err.message));
    return res.json({ received: true });
  }

  const toolCalls = message.toolCallList || [];

  const results = await Promise.all(
    toolCalls.map(async (toolCall) => {
      try {
        if (isRateLimited(rateLimitKey(toolCall.name, callContext), RATE_LIMITS.default) ||
            (RATE_LIMITS[toolCall.name] && isRateLimited(rateLimitKey(toolCall.name, callContext), RATE_LIMITS[toolCall.name]))) {
          return { toolCallId: toolCall.id, result: "Error: too many requests from this caller recently - please try again later." };
        }
        const output = await runTool(toolCall.name, toolCall.arguments || {}, callContext, promptVariant);
        return { toolCallId: toolCall.id, result: JSON.stringify(output) };
      } catch (err) {
        // Without this, a broken booking/quote just becomes a vague thing
        // Alex says on the call - nobody finds out until the customer
        // complains their appointment never actually got scheduled.
        Sentry.captureException(err, { extra: { toolName: toolCall.name, toolArgs: toolCall.arguments, vapiCallId: callContext.vapiCallId } });

        // Three failure-mode protections against "an outage silently means
        // missed calls again," which is the whole product promise:
        //   1. Tell the caller something sane instead of a raw error - a
        //      literal "Error: ..." string handed to the model can produce
        //      anything, including reading the error out loud.
        //   2. Log this as a lead needing a human callback, same as any
        //      other escalation, so the office can actually follow up.
        //   3. Count it toward the outage circuit breaker - if this keeps
        //      happening, the owner gets texted directly within minutes.
        const companyId = getCompanyId();
        logSystemErrorForFollowup({ companyId, vapiCallId: callContext.vapiCallId, customerPhone: callContext.customerPhone, toolName: toolCall.name })
          .catch(() => {}); // already logs its own failures internally
        recordFailureAndMaybeAlert(companyId, err, { toolName: toolCall.name, vapiCallId: callContext.vapiCallId });

        return {
          toolCallId: toolCall.id,
          result: "Error: something went wrong on our end just now, not the caller's fault. Apologize briefly, let them know a real person will call them back shortly to finish this, and don't retry this action again this call.",
        };
      }
    })
  );
  res.json({ results });
});

// Vapi's end-of-call payload shape for the transcript/duration fields is
// unverified here - confirm against a real call before relying on this.
// Non-fatal either way: a missing transcript shouldn't be a 500 to Vapi.
async function handleEndOfCallReport(message, callContext) {
  if (!callContext.vapiCallId) return;
  try {
    const supabase = getSupabase();
    const patch = {};
    if (typeof message.transcript === "string") patch.transcript = message.transcript;
    if (typeof message.durationSeconds === "number") patch.duration_seconds = Math.round(message.durationSeconds);
    if (!patch.ended_at) patch.ended_at = new Date().toISOString();
    const { data: existing } = await supabase.from("calls").select("id, outcome").eq("vapi_call_id", callContext.vapiCallId).maybeSingle();
    if (!existing) return; // Nothing was ever recorded for this call - no tool ran, no lead to attach a transcript to.
    // "abandoned" is the row's default outcome (see findOrCreateLeadForCall)
    // until quoted/booked/transferred overwrites it - leave a real outcome
    // alone, only fill in the still-default one.
    await supabase.from("calls").update(patch).eq("id", existing.id);
  } catch (err) {
    console.error("handleEndOfCallReport failed (non-fatal):", err.message);
  }
}

async function runTool(name, args, callContext, promptVariant) {
  const companyId = getCompanyId();

  switch (name) {
    case "get_quote": {
      const validated = validateQuoteArgs(args);
      const q = await calcQuote({
        companyId,
        jobType: validated.jobType,
        property: validated.property,
        urgency: validated.urgency,
        partsTier: validated.partsTier,
      });
      await recordQuote({
        companyId,
        vapiCallId: callContext.vapiCallId,
        customerPhone: callContext.customerPhone,
        jobType: validated.jobType,
        urgency: validated.urgency,
        property: validated.property,
        quote: q,
        promptVariant,
      });
      return {
        jobLabel: q.jobLabel,
        low: q.low,
        high: q.high,
        message: `${q.jobLabel} runs $${q.low} to $${q.high} CAD.`,
      };
    }

    case "check_availability": {
      const urgency = typeof args.urgency === "string" ? args.urgency : "standard";
      const slots = await nextAvailableSlots(urgency, companyId);
      return { slots };
    }

    case "book_appointment": {
      const validated = validateBookingArgs(args);
      const result = await createBooking({
        companyId,
        vapiCallId: callContext.vapiCallId,
        slot: validated.slot,
        jobType: validated.jobType,
        address: validated.address,
        customerPhone: validated.customerPhone || callContext.customerPhone,
        customerName: validated.customerName,
        smsConsent: args.smsConsent === true,
      });
      if (!result.ok) return { booked: false, reason: result.reason };
      // is_callback (see lib/booking.js's findRecentCallbackSource) means
      // this is a no-charge return visit on recent work, not a fresh
      // billable job - tell Alex explicitly so it gets said on the call
      // instead of quietly showing up as $0 only on the office's dashboard.
      if (result.job?.is_callback) {
        return { booked: true, slot: validated.slot, noCharge: true, message: "This is a follow-up on recent work, so there's no charge for the visit." };
      }
      return { booked: true, slot: validated.slot };
    }

    case "escalate_to_human": {
      const reason = typeof args.reason === "string" ? args.reason.slice(0, 300) : "unspecified";
      await escalateToHuman({
        companyId,
        vapiCallId: callContext.vapiCallId,
        customerPhone: callContext.customerPhone,
        reason,
        promptVariant,
      });
      return { escalated: true };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Catches anything that escapes the per-tool-call try/catch above (e.g. a
// throw in checkAuth, or a future route added without its own handling).
// Must come after every route is defined.
Sentry.setupExpressErrorHandler(app);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sable receptionist webhook listening on port ${PORT}`);
});
