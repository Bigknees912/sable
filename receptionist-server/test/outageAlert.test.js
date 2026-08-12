const { test } = require("node:test");
const assert = require("node:assert/strict");
const { recordFailureAndMaybeAlert } = require("../lib/outageAlert");

function withEnv(vars, fn) {
  const prev = {};
  for (const key of Object.keys(vars)) prev[key] = process.env[key];
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const key of Object.keys(vars)) process.env[key] = prev[key];
  }
}

test("recordFailureAndMaybeAlert: does not fire until the failure threshold is reached", async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true };
  };
  try {
    await withEnv({ OUTAGE_ALERT_URL: "https://example.test/alert", OUTAGE_ALERT_WEBHOOK_SECRET: "s3cr3t" }, async () => {
      const companyId = `company-${Math.random()}`;
      recordFailureAndMaybeAlert(companyId, new Error("boom 1"), {});
      recordFailureAndMaybeAlert(companyId, new Error("boom 2"), {});
      // Only 2 failures so far - below the threshold of 3, nothing should fire.
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(calls.length, 0, "should not alert below the failure threshold");

      recordFailureAndMaybeAlert(companyId, new Error("boom 3"), {});
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(calls.length, 1, "should alert once the threshold is crossed");

      const body = JSON.parse(calls[0].opts.body);
      assert.equal(body.companyId, companyId);
      assert.equal(body.failureCount, 3);
      assert.equal(body.lastError, "boom 3");
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("recordFailureAndMaybeAlert: does not alert again immediately (cooldown)", async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true };
  };
  try {
    await withEnv({ OUTAGE_ALERT_URL: "https://example.test/alert", OUTAGE_ALERT_WEBHOOK_SECRET: "s3cr3t" }, async () => {
      const companyId = `company-${Math.random()}`;
      for (let i = 0; i < 5; i++) recordFailureAndMaybeAlert(companyId, new Error(`boom ${i}`), {});
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(calls.length, 1, "should only alert once within the cooldown window even with more failures");
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("recordFailureAndMaybeAlert: silently no-ops without throwing when unconfigured", () => {
  const companyId = `company-${Math.random()}`;
  assert.doesNotThrow(() => {
    for (let i = 0; i < 5; i++) recordFailureAndMaybeAlert(companyId, new Error("boom"), {});
  });
});
