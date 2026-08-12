// Builds the Vapi assistant definition (system prompt + tool schemas) from
// this company's own trade and service catalog, instead of a single
// hand-written prompt that assumed plumbing. Pure function, no I/O - see
// generate-assistant.js for the script that fetches real company/job_types
// data and calls this. An electrician's generated prompt only ever
// mentions the job types actually in their catalog (panel, outlet,
// wiring...), never "drain" - there's no shared vocabulary to leak from,
// since the job type list and emergency cues are both looked up by trade.

// Short, trade-specific phrasing for "how Alex recognizes an emergency
// without asking" - the one part of the old prompt that named specific
// plumbing disaster scenarios (flooding/burst pipes/sewage) instead of
// just referring to "the job". Kept as a small code-level map (like
// src/lib/plans.js's BLURBS) rather than DB data, since it's prompt
// copywriting, not business data an owner edits.
const EMERGENCY_CUES = {
  Plumbing: "flooding, a burst pipe, sewage backup, or no water at all",
  Electrical: "sparking, a burning smell, exposed wires, a total power outage, or any shock risk",
  HVAC: "no heat in freezing weather, no AC in extreme heat, or a gas smell",
  Roofing: "an active leak during a storm, or visible structural damage",
  Locksmith: "someone locked out with no safe way back in, or a break-in/compromised lock",
};
const DEFAULT_EMERGENCY_CUES = "anything that sounds like a genuine safety emergency";

// A/B test (opening line only, for now): companies.assistant_prompt_variant
// isn't a real column - the variant is chosen per-assistant-deployment
// (see generate-assistant.js's --variant flag) and stamped onto each call
// via the ?variant= query param on that deployment's webhook URL, not
// looked up from the database. 'b' opens by naming the trade directly
// instead of just the company name, on the theory that "the plumber who
// answers" is a stronger opening than a bare business name for a caller
// who isn't sure they dialed the right kind of business. Extend this
// object (not the branching logic) to add a third variant.
const OPENING_LINES = {
  a: (company) => `${company.name}, this is Alex. What's going on?`,
  b: (company, tradeLower) => `${tradeLower} emergency or routine? This is Alex at ${company.name}.`,
};

function buildSystemPrompt({ company, jobTypes }) {
  const trade = company.trade || "service";
  const tradeLower = trade.toLowerCase();
  const areaClause = company.service_area ? ` serving ${company.service_area}` : "";
  const jobTypeList = jobTypes.map((jt) => `${jt.key} (${jt.label})`).join(", ");
  const emergencyCues = EMERGENCY_CUES[trade] || DEFAULT_EMERGENCY_CUES;

  return `You are Alex, the AI phone receptionist for ${company.name}, a ${tradeLower} company${areaClause}.

This is a real phone call, not a chat. Follow these rules strictly:
- One short sentence per turn, two only if necessary. Under 15 words whenever possible.
- Ask exactly one question at a time.
- No filler like 'I understand' or 'thank you for that information.' Talk like a busy, competent human dispatcher: quick, plain, warm but brief.

Gather these details through natural conversation: jobType (${jobTypeList} - infer from what they describe), property (residential or commercial), urgency (standard, sameday, or emergency - infer emergency automatically from ${emergencyCues}, without asking), address (their full street address - ask plainly, never ask for a city quadrant), and partsTier (basic, mid, or premium, default to mid if not mentioned).

Once you have jobType, property, and urgency, call the get_quote tool and read the price range back to the caller in one short line, then ask if they want to book it.

If they say yes, get their first and last name before offering times - you need it to put the job on the schedule. Then ask this exact permission question, word for word, before offering times: "Is it okay if we text you updates about your appointment, like when the tech's on the way? Message and data rates may apply, and you can text STOP anytime - this won't affect your booking either way." Wait for a clear yes or no. Never assume yes, and never skip this question even for a returning caller.

Then call check_availability with the urgency, and offer the returned slots briefly. If they name a day/time not on the list, that's fine, just use what they said as the slot. Once they confirm a specific slot, call book_appointment with the slot, jobType, address, customerName, and smsConsent (true only if they clearly said yes to the texting question - false or omitted otherwise). Confirm the booking in one short line.

Never state a price without calling get_quote first. Never claim a slot is booked without calling book_appointment first. Never set smsConsent to true unless they explicitly agreed when asked.

If book_appointment's result includes a message about there being no charge (a callback on recent work), say that plainly in your confirmation - the caller should hear it's free before they hang up, not find out only when the tech arrives.

When a caller rambles, over-explains, or drifts off-topic: let them finish the sentence they're on, then in one short line acknowledge the one relevant detail you caught and ask the single question you're still waiting on. Don't repeat their whole story back, don't ask them to "get to the point," and don't stack it with a second question - just steer, once, back to what you need.

When a caller corrects themselves mid-sentence or contradicts something they said a moment ago ("actually it's not the kitchen sink, it's the bathroom one"), always keep their most recent statement, not their first one, for whichever field it affects. Confirm the correction in passing rather than starting the question over: "Bathroom sink, got it - and is that today or can it wait?" If two of their statements genuinely conflict and you can't tell which one is current, ask a single direct clarifying question naming both options instead of guessing.

If a caller asks about something you have no way to help with right now - a dispute over a past invoice, a complaint about work already done, a question about a completely different trade, anything that isn't booking a ${tradeLower} job - don't guess an answer and don't apologize at length. Say in one short line that you'll have someone call them back about that specifically, then call the escalate_to_human tool with a brief reason. If they also have a real ${tradeLower} job to book in the same call, keep going with that normally after escalating the other thing.

Read back the address and phone number in your own words before booking, so a mishearing gets caught before a tech is sent to the wrong place: "Just to confirm, that's [address] - is that right?" Do this once per call, briefly, not for every field.

If the caller goes quiet for a while mid-call, check in once - "Still there?" - before assuming the line dropped. If they don't respond to that either, end the call politely rather than repeating yourself.

Warmth matters as much as speed. A caller with a real emergency is often stressed - acknowledge it briefly ("that's not fun, let's get someone out there") before moving to the next question, don't just barrel through like a form. On a routine call, a small human touch at the end goes a long way: after booking, close with a short, genuine line like "we'll take care of you" or "thanks for calling" rather than ending abruptly the moment the tool call succeeds.`;
}

/**
 * @param {{company: {name: string, trade: string, service_area?: string}, jobTypes: {key: string, label: string}[], webhookUrl: string, variant?: 'a'|'b'}} input
 */
function buildAssistantConfig({ company, jobTypes, webhookUrl, variant = "a" }) {
  if (!jobTypes || jobTypes.length === 0) {
    throw new Error("Cannot build an assistant config with an empty service catalog - add at least one active job type first.");
  }
  const tradeLower = (company.trade || "service").toLowerCase();
  const jobKeys = jobTypes.map((jt) => jt.key);
  const openingLineFn = OPENING_LINES[variant] || OPENING_LINES.a;

  return {
    name: `${company.name} Receptionist (variant ${variant})`,
    firstMessage: openingLineFn(company, tradeLower),
    model: {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      systemPrompt: buildSystemPrompt({ company, jobTypes }),
    },
    // Until now this block set only a provider and a voice id, so every
    // expressiveness knob fell through to the provider default. ElevenLabs
    // defaults to high stability, which flattens the micro-variation in pitch
    // and pace that makes a voice read as human - that is the usual cause of
    // "it sounds like a bot," and no amount of system-prompt warmth fixes it,
    // because the prompt controls word choice and these control delivery.
    voice: {
      provider: "11labs",
      voiceId: "REPLACE_WITH_YOUR_CHOSEN_VOICE_ID",
      // Turbo v2.5 is the streaming model: phone audio is 8kHz anyway, so the
      // extra fidelity of a non-streaming model buys nothing and costs latency.
      model: "eleven_turbo_v2_5",
      // Low stability = more emotional range. Pushed below the 0.5 default on
      // purpose; go lower for more life, higher if a voice starts wandering.
      stability: 0.45,
      similarity_boost: 0.78,
      // Slight style exaggeration for warmth. Past ~0.6 it distorts, and it
      // costs latency, so this stays deliberately low.
      style: 0.2,
      useSpeakerBoost: true,
    },
    // "Puts up with the customer talking": Vapi's call-behavior knobs, not
    // prompt text - no system prompt can fix an assistant that barges in on
    // a caller's mid-sentence pause or refuses to yield when talked over.
    //   startSpeakingPlan.waitSeconds gives a caller who's mid-thought a
    //     real half-second of silence before Alex assumes they're done and
    //     starts talking - the single biggest source of "it cut me off."
    //   stopSpeakingPlan lets the caller interrupt ALEX after just a couple
    //     words, so correcting Alex mid-sentence ("no, the other one") works
    //     the way it would with a human, not just at the end of a turn.
    // Both are real Vapi assistant fields, not custom - tune waitSeconds up
    // slightly for a slower-talking customer base if callers report being
    // cut off in practice.
    startSpeakingPlan: {
      waitSeconds: 0.6,
      smartEndpointingEnabled: true,
    },
    stopSpeakingPlan: {
      numWords: 2,
      voiceSeconds: 0.3,
      backoffSeconds: 1,
    },
    // Trade jobsites and driving are loud - filters out background noise
    // instead of transcribing it as if the caller said it.
    backgroundDenoisingEnabled: true,
    serverUrl: webhookUrl,
    tools: [
      {
        type: "function",
        function: {
          name: "get_quote",
          description: `Calculates the estimated price range for a ${tradeLower} job. Call this once jobType, property, and urgency are known.`,
          parameters: {
            type: "object",
            properties: {
              jobType: { type: "string", enum: jobKeys },
              property: { type: "string", enum: ["residential", "commercial"] },
              urgency: { type: "string", enum: ["standard", "sameday", "emergency"] },
              partsTier: { type: "string", enum: ["basic", "mid", "premium"] },
            },
            required: ["jobType", "property", "urgency"],
          },
        },
        server: { url: webhookUrl },
      },
      {
        type: "function",
        function: {
          name: "check_availability",
          description: "Returns real available appointment slots for the given urgency level. Call this after the caller agrees to book.",
          parameters: {
            type: "object",
            properties: {
              urgency: { type: "string", enum: ["standard", "sameday", "emergency"] },
            },
            required: ["urgency"],
          },
        },
        server: { url: webhookUrl },
      },
      {
        type: "function",
        function: {
          name: "book_appointment",
          description: "Books the job into the schedule once the caller confirms a specific slot.",
          parameters: {
            type: "object",
            properties: {
              slot: { type: "string", description: "The exact slot string the caller agreed to" },
              jobType: { type: "string", enum: jobKeys },
              address: { type: "string" },
              customerName: { type: "string", description: "The caller's first and last name" },
              customerPhone: { type: "string" },
              smsConsent: { type: "boolean", description: "True only if the caller explicitly agreed, when asked, to receive text updates about their appointment. False or omit if they declined or weren't clearly asked." },
            },
            required: ["slot", "jobType", "address", "customerName"],
          },
        },
        server: { url: webhookUrl },
      },
      {
        type: "function",
        function: {
          name: "escalate_to_human",
          description: `Call this when the caller asks about something outside booking a ${tradeLower} job - a billing dispute, a complaint about past work, an unrelated trade, or anything else Alex can't actually resolve. Logs it for a human callback instead of guessing an answer.`,
          parameters: {
            type: "object",
            properties: {
              reason: { type: "string", description: "One short phrase describing what the caller needs a human for." },
            },
            required: ["reason"],
          },
        },
        server: { url: webhookUrl },
      },
    ],
  };
}

module.exports = { buildAssistantConfig, EMERGENCY_CUES };
