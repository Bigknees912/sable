const { getSupabase } = require("./supabase");
const { resolveSlot } = require("./scheduling");
const { withRetry } = require("./retry");

// Every function below takes its Supabase client as a parameter (default:
// the real one from getSupabase()) rather than calling getSupabase()
// internally - this is what lets test/booking.test.js exercise the real
// branching logic (new vs existing customer, slot conflicts, SMS consent)
// against a fake in-memory client instead of a live database. Purely a
// testability refactor - behavior and call sites are unchanged.

async function getJobType(supabase, companyId, key) {
  if (!key) return null;
  const { data, error } = await supabase
    .from("job_types")
    .select("id, label")
    .eq("company_id", companyId)
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Upserts an `estimates` row keyed by this call's id every time a quote is
 * given, so it shows up on the dashboard's Estimates page even if the
 * caller never books - a quote that goes unanswered is exactly what that
 * page's 48-hour Follow Up prompt exists to catch. Keyed on call id (not
 * vapi_call_id directly) since it links back to the `calls` row via FK,
 * same relationship jobs.call_id already uses. Non-fatal, same reasoning
 * as recordQuote itself - a logging hiccup here must never break a live
 * call's ability to get a price.
 */
async function upsertEstimateForCall(supabase, companyId, callId, { customerPhone, jobTypeRow, quote }) {
  if (!callId) return;
  try {
    let customerId = null;
    if (customerPhone) {
      const { data: existing } = await supabase
        .from("customers")
        .select("id, name")
        .eq("company_id", companyId)
        .eq("phone", customerPhone)
        .maybeSingle();
      customerId = existing?.id || null;
    }
    const patch = {
      company_id: companyId,
      call_id: callId,
      customer_id: customerId,
      customer_phone: customerPhone || null,
      job_type_id: jobTypeRow?.id || null,
      description: jobTypeRow?.label || null,
      price_low: quote.low,
      price_high: quote.high,
      source: "phone_ai",
    };
    const { data: existingEstimate } = await supabase.from("estimates").select("id").eq("call_id", callId).maybeSingle();
    if (existingEstimate) {
      await supabase.from("estimates").update(patch).eq("id", existingEstimate.id);
    } else {
      await supabase.from("estimates").insert({ ...patch, status: "sent" });
    }
  } catch (err) {
    console.error("upsertEstimateForCall failed (non-fatal, call continues):", err.message);
  }
}

/**
 * Finds or creates a `customers` row for this caller and a `calls` row
 * linking to it, as early in the conversation as possible - a real lead in
 * the CRM pipeline (at "new_lead") the instant we know who's calling, not
 * only once they book. Idempotent: safe to call from every tool handler
 * (get_quote, escalate_to_human, a future call-start webhook event, ...)
 * without creating duplicate customers or calls rows for the same call.
 * Never throws - same "logging must never break a live call" reasoning as
 * recordQuote/createBooking.
 */
async function findOrCreateLeadForCall({ companyId, vapiCallId, customerPhone, customerName, promptVariant, supabaseClient }) {
  const supabase = supabaseClient || getSupabase();
  try {
    let customerId = null;
    if (customerPhone) {
      const { data: existing } = await supabase
        .from("customers")
        .select("id")
        .eq("company_id", companyId)
        .eq("phone", customerPhone)
        .maybeSingle();
      customerId = existing?.id || null;
      if (!customerId) {
        const { data: created, error: createError } = await withRetry(() =>
          supabase
            .from("customers")
            .insert({ company_id: companyId, name: customerName || "Phone caller", phone: customerPhone, pipeline_stage: "new_lead" })
            .select("id")
            .single()
        );
        if (createError) throw createError;
        customerId = created.id;
      }
    }

    if (!vapiCallId) return customerId;
    const { data: existingCall } = await supabase.from("calls").select("id, customer_id, prompt_variant").eq("vapi_call_id", vapiCallId).maybeSingle();
    if (existingCall) {
      // Don't clobber a customer_id a later step (recordQuote/createBooking)
      // may have already matched more specifically, or a prompt_variant
      // already stamped by an earlier call to this same function.
      const patch = {};
      if (!existingCall.customer_id && customerId) patch.customer_id = customerId;
      if (!existingCall.prompt_variant && promptVariant) patch.prompt_variant = promptVariant;
      if (Object.keys(patch).length > 0) await supabase.from("calls").update(patch).eq("id", existingCall.id);
    } else {
      await supabase.from("calls").insert({
        company_id: companyId,
        vapi_call_id: vapiCallId,
        customer_phone: customerPhone || null,
        customer_id: customerId,
        prompt_variant: promptVariant || null,
        outcome: "abandoned", // overwritten by recordQuote/createBooking/escalate as the call progresses
      });
    }
    return customerId;
  } catch (err) {
    console.error("findOrCreateLeadForCall failed (non-fatal, call continues):", err.message);
    return null;
  }
}

/**
 * Upserts a `calls` row keyed by Vapi's call id every time get_quote runs,
 * so the row tracks the conversation's latest quote even if the caller
 * asks for a couple of variations before booking - and so book_appointment
 * (which gets no urgency/price args of its own from Vapi) can look this
 * back up. Never throws - a logging hiccup here shouldn't break a live
 * call's ability to get a price.
 */
async function recordQuote({ companyId, vapiCallId, customerPhone, jobType, urgency, property, quote, promptVariant, supabaseClient }) {
  if (!vapiCallId) return;
  const supabase = supabaseClient || getSupabase();
  try {
    const customerId = await findOrCreateLeadForCall({ companyId, vapiCallId, customerPhone, promptVariant, supabaseClient: supabase });
    const jobTypeRow = await getJobType(supabase, companyId, jobType);
    const patch = {
      company_id: companyId,
      customer_phone: customerPhone || null,
      customer_id: customerId,
      job_type_id: jobTypeRow?.id || null,
      urgency: urgency || null,
      property_type: property || null,
      quote_low: quote.low,
      quote_high: quote.high,
      outcome: "quoted",
    };
    const { data: existing } = await supabase.from("calls").select("id").eq("vapi_call_id", vapiCallId).maybeSingle();
    let callId = existing?.id;
    if (existing) {
      await supabase.from("calls").update(patch).eq("id", existing.id);
    } else {
      const { data: created } = await supabase.from("calls").insert({ ...patch, vapi_call_id: vapiCallId }).select("id").single();
      callId = created?.id;
    }
    if (customerId) {
      // A quote is real pipeline movement - "new_lead" was just "we know
      // who called", "quoted" is "we've told them a price". Only advances
      // forward, never backward (e.g. a customer already "booked" from a
      // prior job who calls again for a quote shouldn't regress).
      await advancePipelineStage(supabase, customerId, "quoted");
    }
    await upsertEstimateForCall(supabase, companyId, callId, { customerPhone, jobTypeRow, quote });
  } catch (err) {
    console.error("recordQuote failed (non-fatal, call continues):", err.message);
  }
}

const STAGE_ORDER = ["new_lead", "contacted", "quoted", "booked", "completed", "nurture"];
async function advancePipelineStage(supabase, customerId, targetStage) {
  const { data: current } = await supabase.from("customers").select("pipeline_stage").eq("id", customerId).maybeSingle();
  const currentIdx = STAGE_ORDER.indexOf(current?.pipeline_stage);
  const targetIdx = STAGE_ORDER.indexOf(targetStage);
  if (targetIdx === -1) return;
  if (currentIdx === -1 || targetIdx > currentIdx) {
    await supabase.from("customers").update({ pipeline_stage: targetStage }).eq("id", customerId);
  }
}

/**
 * Handles a caller asking for something Alex genuinely can't help with (a
 * billing dispute, a complaint about past work, an unrelated trade) - logs
 * it as a lead needing a human callback rather than guessing an answer.
 * "transferred" is an existing calls.outcome value (see migration
 * 002_jobs_domain) - this is the first thing to actually set it.
 */
async function escalateToHuman({ companyId, vapiCallId, customerPhone, reason, promptVariant, supabaseClient }) {
  const supabase = supabaseClient || getSupabase();
  try {
    const customerId = await findOrCreateLeadForCall({ companyId, vapiCallId, customerPhone, promptVariant, supabaseClient: supabase });
    if (vapiCallId) {
      await supabase.from("calls").update({ outcome: "transferred", ended_at: new Date().toISOString() }).eq("vapi_call_id", vapiCallId);
    }
    if (customerId) {
      await supabase.from("customer_interactions").insert({
        company_id: companyId,
        customer_id: customerId,
        type: "call",
        body: `Caller asked something outside Alex's scope: ${reason || "unspecified"}. Needs a human callback.`,
      });
    }
  } catch (err) {
    console.error("escalateToHuman failed (non-fatal, call continues):", err.message);
  }
}

/**
 * Records SMS consent Alex captured verbally during the call, per the
 * exact permission-question script in vapi-assistant.json's systemPrompt.
 * Only ever turns consent ON, mirroring the dashboard app's
 * findOrCreateCustomer (src/lib/jobs.js) - a caller who doesn't clearly
 * confirm this time isn't treated as revoking consent they gave on a
 * previous call, since the assistant not asking clearly isn't the same as
 * the customer saying no. Real revocation happens via an explicit STOP
 * reply (handled in the SMS-sending edge functions) or the dashboard's
 * Clients page toggle. See AUTH.md "SMS consent & compliance".
 */
async function applySmsConsent(supabase, companyId, customerId, smsConsent) {
  if (!smsConsent) return;
  const { error: updateError } = await supabase
    .from("customers")
    .update({ sms_consent: true, sms_consent_at: new Date().toISOString(), sms_consent_method: "phone_call" })
    .eq("id", customerId);
  if (updateError) throw updateError;

  const { error: eventError } = await supabase.from("sms_consent_events").insert({
    company_id: companyId,
    customer_id: customerId,
    consent: true,
    method: "phone_call",
    note: "Captured verbally during phone booking (Alex)",
  });
  if (eventError) throw eventError;
}

// Fallback window if a company hasn't set companies.callback_window_days
// (migration 067). 30 days covers "the fix didn't hold" for most trades
// without also flagging an unrelated new job of the same type months later.
const DEFAULT_CALLBACK_WINDOW_DAYS = 30;

async function getCallbackWindowDays(supabase, companyId) {
  try {
    const { data } = await supabase.from("companies").select("callback_window_days").eq("id", companyId).maybeSingle();
    const n = data?.callback_window_days;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_CALLBACK_WINDOW_DAYS;
  } catch {
    return DEFAULT_CALLBACK_WINDOW_DAYS;
  }
}

/**
 * Looks for a recently completed job of the same type that this caller is
 * likely calling back about - matched by the same customer (phone) OR the
 * same service address, within the company's configured window. If found,
 * this new booking is a possible warranty callback on that work, not a new
 * charge. Never throws: a lookup failure here should just mean "treat as a
 * normal new job," not break a live booking.
 */
async function findRecentCallbackSource(supabase, companyId, { customerId, jobTypeId, address, windowDays }) {
  if (!jobTypeId) return null;
  if (!customerId && !address) return null;
  try {
    const since = new Date(Date.now() - (windowDays || DEFAULT_CALLBACK_WINDOW_DAYS) * 24 * 60 * 60 * 1000).toISOString();
    let query = supabase
      .from("jobs")
      .select("id, assigned_tech_id, customer_id, address")
      .eq("company_id", companyId)
      .eq("job_type_id", jobTypeId)
      .eq("status", "done")
      .gte("completed_at", since)
      .order("completed_at", { ascending: false })
      .limit(1);
    // Match on the same customer (phone-resolved) or the same address -
    // covers a returning caller who calls from a different number but the
    // work is at the same place.
    if (customerId && address) query = query.or(`customer_id.eq.${customerId},address.eq.${address}`);
    else if (customerId) query = query.eq("customer_id", customerId);
    else query = query.eq("address", address);
    const { data } = await query.maybeSingle();
    return data || null;
  } catch (err) {
    console.error("findRecentCallbackSource failed (non-fatal, treated as a new job):", err.message);
    return null;
  }
}

/**
 * Creates the real booking: finds/creates the customer, inserts the job,
 * and marks the call's outcome "booked". Returns { ok: false, reason } on
 * a slot conflict (mirrors the old bookings.json race-guard) so the
 * assistant can offer the next available slot instead.
 */
async function createBooking({ companyId, vapiCallId, slot, jobType, address, customerPhone, customerName, smsConsent, supabaseClient }) {
  const supabase = supabaseClient || getSupabase();

  let call = null;
  if (vapiCallId) {
    const { data } = await supabase.from("calls").select("*").eq("vapi_call_id", vapiCallId).maybeSingle();
    call = data;
  }
  const urgency = call?.urgency || "standard";
  const resolved = resolveSlot(slot, urgency);

  // Structured-slot double-booking guard. Freeform slots (the caller named
  // their own day/time instead of picking an offered one) can't be
  // conflict-checked this way - there's no reliable date to compare.
  if (resolved?.date) {
    const { data: conflict, error: conflictError } = await supabase
      .from("jobs")
      .select("id")
      .eq("company_id", companyId)
      .eq("scheduled_date", resolved.date)
      .eq("scheduled_window", resolved.window)
      .neq("status", "cancelled")
      .maybeSingle();
    if (conflictError) throw conflictError;
    if (conflict) {
      return { ok: false, reason: "That slot was just taken. Please offer the next available one." };
    }
  }

  let customerId = null;
  if (customerPhone) {
    const { data: existing } = await supabase
      .from("customers")
      .select("id")
      .eq("company_id", companyId)
      .eq("phone", customerPhone)
      .maybeSingle();
    customerId = existing?.id || null;
  }
  if (!customerId) {
    // pipeline_stage: "booked" - a job is being created in the same
    // request, same convention as the dashboard app's findOrCreateCustomer
    // (src/lib/jobs.js). Wrapped in withRetry - a booking made live over
    // the phone has no "try again" button, so a momentary network blip
    // here shouldn't lose it.
    const { data: created, error: createError } = await withRetry(() =>
      supabase
        .from("customers")
        .insert({ company_id: companyId, name: customerName || "Phone caller", phone: customerPhone || null, address, pipeline_stage: "booked" })
        .select("id")
        .single()
    );
    if (createError) throw createError;
    customerId = created.id;
  } else {
    // An existing customer (already a lead from an earlier call, or a
    // repeat customer) advances to "booked" too - previously this branch
    // left their stage untouched, so a lead who'd been quoted never moved
    // forward on the pipeline board even after actually booking.
    await advancePipelineStage(supabase, customerId, "booked");
  }

  await applySmsConsent(supabase, companyId, customerId, smsConsent);

  const jobTypeRow = await getJobType(supabase, companyId, jobType);
  const callbackWindowDays = await getCallbackWindowDays(supabase, companyId);
  const callbackSource = await findRecentCallbackSource(supabase, companyId, {
    customerId,
    jobTypeId: jobTypeRow?.id,
    address,
    windowDays: callbackWindowDays,
  });

  // jobs_no_double_booking_idx (migration 048) is the real guard against
  // two concurrent calls booking the same slot - the SELECT check above
  // narrows the race window but can't close it (classic check-then-insert
  // race), so a 23505 unique-violation here means someone else's booking
  // won the race in the gap between that check and this insert. That's
  // not a transient failure (retrying would just hit the same conflict
  // again), so it's handled before withRetry ever sees it.
  const { data: job, error: jobError } = await withRetry(() =>
    supabase
      .from("jobs")
      .insert({
        company_id: companyId,
        customer_id: customerId,
        job_type_id: jobTypeRow?.id || null,
        description: callbackSource
          ? `${jobTypeRow?.label || jobType} - possible warranty callback, needs owner review (original job ${callbackSource.id.slice(0, 8)})`
          : jobTypeRow?.label || jobType,
        address,
        urgency,
        status: "unassigned",
        scheduled_date: resolved?.date || null,
        scheduled_window: resolved?.window || slot,
        // A possible warranty callback on recent work of the same type is
        // NOT auto-billed - it's booked at $0 and flagged for the owner to
        // make the charge decision (callback_needs_review), rather than
        // silently becoming a normal paid job. See findRecentCallbackSource.
        price_low: callbackSource ? 0 : call?.quote_low ?? null,
        price_high: callbackSource ? 0 : call?.quote_high ?? null,
        is_callback: Boolean(callbackSource),
        original_job_id: callbackSource?.id || null,
        callback_waived: Boolean(callbackSource),
        callback_needs_review: Boolean(callbackSource),
        source: "phone_ai",
        call_id: call?.id || null,
      })
      .select()
      .single()
  );
  if (jobError) {
    if (jobError.code === "23505") {
      return { ok: false, reason: "That slot was just taken. Please offer the next available one." };
    }
    throw jobError;
  }

  if (call) {
    await supabase.from("calls").update({ outcome: "booked", address, customer_id: customerId, ended_at: new Date().toISOString() }).eq("id", call.id);
    // Closes the loop on the Estimates page: the quote given earlier in
    // this same call just turned into a real booking, so it's no longer
    // sitting unfollowed-up - non-fatal, a booking that already succeeded
    // must never fail because this bookkeeping update didn't.
    try {
      await supabase.from("estimates").update({ status: "accepted", job_id: job.id, status_changed_at: new Date().toISOString() }).eq("call_id", call.id);
    } catch (err) {
      console.error("linking estimate to booked job failed (non-fatal):", err.message);
    }
  }

  // A possible warranty callback is routed to the owner for a manual
  // charge decision - drop a CRM note so it surfaces in the interaction
  // feed alongside the "needs review" flag on the job/board. Non-fatal.
  if (callbackSource && customerId) {
    try {
      await supabase.from("customer_interactions").insert({
        company_id: companyId,
        customer_id: customerId,
        type: "call",
        body: `Possible warranty callback: same job type as a job completed within the last ${callbackWindowDays} days (original job ${callbackSource.id.slice(0, 8)}). Booked at no charge and flagged for your review - decide whether to bill before the visit.`,
      });
    } catch (err) {
      console.error("logging callback-review note failed (non-fatal):", err.message);
    }
  }

  return { ok: true, job };
}

/**
 * Logs a mid-call technical failure (a tool threw) as a lead needing a
 * human callback, the same way escalateToHuman does for "outside Alex's
 * scope" cases - except this is "Alex tried and the system broke," so the
 * caller isn't left with a booking that silently never happened. Never
 * throws - this is itself a failure-handling path; it must not compound
 * the outage it's reporting on.
 */
async function logSystemErrorForFollowup({ companyId, vapiCallId, customerPhone, toolName, supabaseClient }) {
  const supabase = supabaseClient || getSupabase();
  try {
    const customerId = await findOrCreateLeadForCall({ companyId, vapiCallId, customerPhone, supabaseClient: supabase });
    if (customerId) {
      await supabase.from("customer_interactions").insert({
        company_id: companyId,
        customer_id: customerId,
        type: "call",
        body: `Alex hit a technical error mid-call (${toolName}) and couldn't finish. Needs a callback to complete their booking/quote.`,
      });
    }
  } catch (err) {
    console.error("logSystemErrorForFollowup failed (non-fatal):", err.message);
  }
}

module.exports = { recordQuote, createBooking, applySmsConsent, findOrCreateLeadForCall, escalateToHuman, logSystemErrorForFollowup };
