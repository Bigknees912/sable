const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildAssistantConfig } = require("../lib/assistantConfig");

const PLUMBING_JOB_TYPES = [
  { key: "drain", label: "Drain Cleaning" },
  { key: "waterheater", label: "Water Heater Install / Repair" },
];
const ELECTRICAL_JOB_TYPES = [
  { key: "panel", label: "Panel Repair / Upgrade" },
  { key: "outlet", label: "Outlet / Switch Install" },
  { key: "evcharger", label: "EV Charger Install" },
];

function fullText(config) {
  return JSON.stringify(config).toLowerCase();
}

test("buildAssistantConfig: an electrician's config never mentions plumbing terms", () => {
  const config = buildAssistantConfig({
    company: { name: "Sparky Electric", trade: "Electrical", service_area: "Calgary" },
    jobTypes: ELECTRICAL_JOB_TYPES,
    webhookUrl: "https://example.com/vapi/webhook",
  });
  const text = fullText(config);
  assert.ok(!text.includes("drain"), "electrician's prompt should never mention drains");
  assert.ok(!text.includes("plumb"), "electrician's prompt should never mention plumbing");
  assert.ok(!text.includes("pipe"), "electrician's prompt should never mention pipes");
  assert.ok(text.includes("sparky electric"));
  assert.ok(text.includes("electrical"));
});

test("buildAssistantConfig: a plumber's config never mentions electrical terms", () => {
  const config = buildAssistantConfig({
    company: { name: "Sable Plumbing & Drain", trade: "Plumbing", service_area: "Calgary" },
    jobTypes: PLUMBING_JOB_TYPES,
    webhookUrl: "https://example.com/vapi/webhook",
  });
  const text = fullText(config);
  assert.ok(!text.includes("breaker"));
  assert.ok(!text.includes("outlet"));
  assert.ok(!text.includes("panel"));
  assert.ok(text.includes("drain"));
});

test("buildAssistantConfig: get_quote/book_appointment jobType enums exactly match this company's job type keys", () => {
  const config = buildAssistantConfig({
    company: { name: "Sparky Electric", trade: "Electrical" },
    jobTypes: ELECTRICAL_JOB_TYPES,
    webhookUrl: "https://example.com/vapi/webhook",
  });
  const getQuote = config.tools.find((t) => t.function.name === "get_quote");
  const bookAppointment = config.tools.find((t) => t.function.name === "book_appointment");
  const expectedKeys = ["panel", "outlet", "evcharger"];
  assert.deepEqual(getQuote.function.parameters.properties.jobType.enum, expectedKeys);
  assert.deepEqual(bookAppointment.function.parameters.properties.jobType.enum, expectedKeys);
});

test("buildAssistantConfig: firstMessage and name reflect this company, not a hardcoded business", () => {
  const config = buildAssistantConfig({
    company: { name: "Reyes HVAC Services", trade: "HVAC" },
    jobTypes: [{ key: "furnace_repair", label: "Furnace Repair" }],
    webhookUrl: "https://example.com/vapi/webhook",
  });
  // Default variant is 'a' - name gets tagged with it (useful once both
  // variants are deployed as separate Vapi assistants for the A/B test)
  // and firstMessage matches OPENING_LINES.a.
  assert.equal(config.name, "Reyes HVAC Services Receptionist (variant a)");
  assert.equal(config.firstMessage, "Reyes HVAC Services, this is Alex. What's going on?");
});

test("buildAssistantConfig: variant 'b' gets a different opening line and is tagged in the name", () => {
  const config = buildAssistantConfig({
    company: { name: "Reyes HVAC Services", trade: "HVAC" },
    jobTypes: [{ key: "furnace_repair", label: "Furnace Repair" }],
    webhookUrl: "https://example.com/vapi/webhook",
    variant: "b",
  });
  assert.equal(config.name, "Reyes HVAC Services Receptionist (variant b)");
  assert.equal(config.firstMessage, "hvac emergency or routine? This is Alex at Reyes HVAC Services.");
});

test("buildAssistantConfig: every tool's server url is the provided webhookUrl", () => {
  const config = buildAssistantConfig({
    company: { name: "Test Co", trade: "Roofing" },
    jobTypes: [{ key: "repair", label: "Roof Repair / Leak" }],
    webhookUrl: "https://my-real-deploy.example.com/vapi/webhook",
  });
  assert.equal(config.serverUrl, "https://my-real-deploy.example.com/vapi/webhook");
  for (const tool of config.tools) {
    assert.equal(tool.server.url, "https://my-real-deploy.example.com/vapi/webhook");
  }
});

test("buildAssistantConfig: an unrecognized trade falls back to generic emergency language instead of throwing", () => {
  const config = buildAssistantConfig({
    company: { name: "Anything Co", trade: "Pest Control" },
    jobTypes: [{ key: "inspection", label: "Inspection" }],
    webhookUrl: "https://example.com/vapi/webhook",
  });
  assert.ok(config.model.systemPrompt.includes("genuine safety emergency"));
});

test("buildAssistantConfig: throws with an empty service catalog instead of generating a broken assistant", () => {
  assert.throws(
    () => buildAssistantConfig({ company: { name: "Empty Co", trade: "Plumbing" }, jobTypes: [], webhookUrl: "https://example.com" }),
    /empty service catalog/
  );
});

test("buildAssistantConfig: sets call-behavior settings so the assistant yields when talked over", () => {
  const config = buildAssistantConfig({
    company: { name: "Test Co", trade: "Plumbing" },
    jobTypes: [{ key: "drain", label: "Drain Cleaning" }],
    webhookUrl: "https://example.com/vapi/webhook",
  });
  assert.ok(config.startSpeakingPlan.waitSeconds > 0, "should wait before assuming the caller is done talking");
  assert.ok(config.stopSpeakingPlan.numWords <= 3, "should let the caller interrupt after only a couple words");
  assert.equal(config.backgroundDenoisingEnabled, true);
});

test("buildAssistantConfig: prompt tells Alex to read back the address/phone and check in on silence", () => {
  const config = buildAssistantConfig({
    company: { name: "Test Co", trade: "Plumbing" },
    jobTypes: [{ key: "drain", label: "Drain Cleaning" }],
    webhookUrl: "https://example.com/vapi/webhook",
  });
  const prompt = config.model.systemPrompt.toLowerCase();
  assert.ok(prompt.includes("confirm") && prompt.includes("address"), "should confirm the address back to the caller");
  assert.ok(prompt.includes("still there"), "should check in once before assuming a dropped call");
});
