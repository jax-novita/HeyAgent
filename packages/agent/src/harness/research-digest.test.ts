import { test } from "node:test";
import assert from "node:assert/strict";
import { extractDigestTopic } from "./research-digest.js";

test("extractDigestTopic: Azerbaijan news", () => {
  const t = extractDigestTopic("собери мне последние новости Азербайджана");
  assert.match(t, /азербайджан/i);
  assert.ok(!/собери/i.test(t));
  assert.ok(!/^последн/i.test(t));
  assert.ok(!/^новост/i.test(t));
});

test("extractDigestTopic: with например", () => {
  const t = extractDigestTopic("собери мне например последние новости Азербайджана");
  assert.match(t, /азербайджан/i);
});

test("extractDigestTopic: pdf report phrasing", () => {
  const t = extractDigestTopic("собери новости мира и сделай pdf отчёт");
  assert.match(t, /мир/i);
});
