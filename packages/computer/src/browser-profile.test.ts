import { test } from "node:test";
import assert from "node:assert/strict";

// Isolate env for profile policy
test("shouldUseRealBrowserProfile: real by default", async () => {
  const prevReal = process.env.HEYAGENT_BROWSER_REAL_PROFILE;
  const prevGuest = process.env.HEYAGENT_BROWSER_GUEST;
  try {
    delete process.env.HEYAGENT_BROWSER_REAL_PROFILE;
    delete process.env.HEYAGENT_BROWSER_GUEST;
    const { shouldUseRealBrowserProfile } = await import("./browser-agent.js");
    assert.equal(shouldUseRealBrowserProfile(), true);

    process.env.HEYAGENT_BROWSER_GUEST = "1";
    assert.equal(shouldUseRealBrowserProfile(), false);

    delete process.env.HEYAGENT_BROWSER_GUEST;
    process.env.HEYAGENT_BROWSER_REAL_PROFILE = "0";
    assert.equal(shouldUseRealBrowserProfile(), false);

    process.env.HEYAGENT_BROWSER_REAL_PROFILE = "1";
    assert.equal(shouldUseRealBrowserProfile(), true);
  } finally {
    if (prevReal === undefined) delete process.env.HEYAGENT_BROWSER_REAL_PROFILE;
    else process.env.HEYAGENT_BROWSER_REAL_PROFILE = prevReal;
    if (prevGuest === undefined) delete process.env.HEYAGENT_BROWSER_GUEST;
    else process.env.HEYAGENT_BROWSER_GUEST = prevGuest;
  }
});
