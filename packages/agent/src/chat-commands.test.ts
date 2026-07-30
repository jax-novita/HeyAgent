import { test } from "node:test";
import assert from "node:assert/strict";
import { tryHandleChatCommand } from "./chat-commands.js";

test("help is handled", async () => {
  const r = await tryHandleChatCommand("/help");
  assert.equal(r.handled, true);
  assert.match(r.reply || "", /switchmodel/);
});

test("plain text is not a command", async () => {
  const r = await tryHandleChatCommand("открой ютуб");
  assert.equal(r.handled, false);
});

test("switchavatar list", async () => {
  const r = await tryHandleChatCommand("/switchavatar");
  assert.equal(r.handled, true);
  assert.match(r.reply || "", /sprite-01/);
});

test("telegram botmention form", async () => {
  const r = await tryHandleChatCommand("/status@MyBot");
  assert.equal(r.handled, true);
  assert.match(r.reply || "", /Модель/);
});
