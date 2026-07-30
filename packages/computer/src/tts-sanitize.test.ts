import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareTextForTts } from "./tts-sanitize.js";

test("prepareTextForTts strips urls and errors", () => {
  const r = prepareTextForTts(
    "Готово. Смотри https://example.com/foo и ERROR: boom\npath: C:\\Users\\x\\a.pdf",
  );
  assert.equal(r.skip, false);
  assert.match(r.text, /Готово/i);
  assert.ok(!/https?:/i.test(r.text));
  assert.ok(!/ERROR/i.test(r.text));
  assert.ok(!/C:\\/i.test(r.text));
});

test("prepareTextForTts skips error-only", () => {
  const r = prepareTextForTts("ERROR: failed hard");
  assert.equal(r.skip, true);
});
