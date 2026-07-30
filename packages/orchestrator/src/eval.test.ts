/**
 * Eval suite scenarios — regression contracts for "don't be stupid" behavior.
 * These are pure routing/planning/verifier checks (no live UI).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeTask } from "./router.js";
import { buildPlan } from "./planner.js";
import { verify } from "./verifier.js";

const scenarios: { name: string; input: string; expectDomain: string; forbid?: string[] }[] = [
  {
    name: "reply in telegram ≠ mail",
    input: "ответь алексу в telegram",
    expectDomain: "messaging",
    forbid: ["mail"],
  },
  {
    name: "chat until goodbye",
    input: "напиши алексу привет и общайся с ним до прощания",
    expectDomain: "messaging",
  },
  {
    name: "open gmail",
    input: "открой gmail",
    expectDomain: "mail",
  },
  {
    name: "youtube lesson",
    input: "открой урок на ютубе про вашингтон",
    expectDomain: "browser",
  },
  {
    name: "already-open math test → browser open_tab not random search",
    input: "я в Яндексе открыл тест по математике пройди его",
    expectDomain: "browser",
  },
  {
    name: "bare Пройди!!!! from phone → browser not general",
    input: "Пройди!!!!",
    expectDomain: "browser",
  },
  {
    name: "Так ответь → continue quiz browser",
    input: "Так ответь",
    expectDomain: "browser",
  },
  {
    name: "reread-style Ответь на вопросы теста → browser not messaging",
    input: "Ответь на вопросы теста по математике",
    expectDomain: "browser",
    forbid: ["messaging", "mail"],
  },
  {
    name: "ответь на вопрос → browser not telegram",
    input: "ответь на вопрос",
    expectDomain: "browser",
    forbid: ["messaging"],
  },
  {
    name: "открой дым с ментолом → browser not Menthol telegram",
    input: "открой мне дым сигарет с ментолом",
    expectDomain: "browser",
    forbid: ["messaging", "mail"],
  },
  {
    name: "volume",
    input: "выключи звук",
    expectDomain: "system",
  },
  {
    name: "bare reply without mail words is messaging",
    input: "ответь алексу что все ок",
    expectDomain: "messaging",
    forbid: ["mail"],
  },
];

for (const s of scenarios) {
  test(`eval: ${s.name}`, () => {
    const r = routeTask(s.input);
    assert.equal(r.domain, s.expectDomain, `got ${r.domain} (${r.reason})`);
    for (const f of s.forbid ?? []) assert.notEqual(r.domain, f);
  });
}

test("eval: no-spam plan always waits after send", () => {
  const plan = buildPlan(
    "общайся",
    routeTask("напиши алексу и общайся до прощания"),
  );
  const kinds = plan.steps.map((x) => x.kind);
  assert.ok(kinds.indexOf("wait_for_reply") > kinds.indexOf("send_message_once"));
});

test("eval: youtube URL must match topic", () => {
  const fail = verify({
    name: "browser_url_ok",
    expectedUrlTopic: "washington",
    world: { at: "", browser: { url: "https://youtube.com/watch?v=orlando", title: "Orlando" } },
  });
  assert.equal(fail.verdict, "fail");
  const pass = verify({
    name: "browser_url_ok",
    expectedUrlTopic: "washington",
    world: {
      at: "",
      browser: { url: "https://youtube.com/watch?v=1", title: "Washington DC tour" },
    },
  });
  assert.equal(pass.verdict, "pass");
});
