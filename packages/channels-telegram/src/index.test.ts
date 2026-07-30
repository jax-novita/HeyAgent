import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRunOptions, AgentRunResult } from "@heyagent/agent";
import {
  parseTelegramUpdate,
  splitTelegramText,
  TelegramChannel,
} from "./index.js";

function fakeTelegramFetch(sent: Array<{ chatId: number; text: string }>): typeof fetch {
  return (async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (typeof body.chat_id === "number" && typeof body.text === "string") {
      sent.push({ chatId: body.chat_id, text: body.text });
    }
    return new Response(JSON.stringify({ ok: true, result: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

function update(updateId: number, chatId: number, text: string): unknown {
  return {
    update_id: updateId,
    message: { message_id: updateId, chat: { id: chatId }, text },
  };
}

test("Telegram validates malformed updates and splits long messages losslessly", () => {
  assert.equal(parseTelegramUpdate(null), null);
  assert.equal(parseTelegramUpdate({ update_id: 1, message: null }), null);
  const text = `${"a".repeat(4090)}\n${"b".repeat(50)}`;
  const chunks = splitTelegramText(text, 4096);
  assert.equal(chunks.length, 2);
  assert.equal(chunks.join("\n"), text);
});

test("one failed chat task does not kill the channel; the next request succeeds", async () => {
  const sent: Array<{ chatId: number; text: string }> = [];
  let calls = 0;
  const agent = {
    async run(_message: string, _options?: AgentRunOptions): Promise<AgentRunResult> {
      calls++;
      if (calls === 1) throw new Error("intentional tool failure");
      return { sessionId: "s", response: "recovered", toolCallsExecuted: [] };
    },
  };
  const channel = new TelegramChannel("test-token", [], {
    agent,
    fetch: fakeTelegramFetch(sent),
    voiceReplies: false,
  });

  assert.equal(await channel.acceptUpdate(update(1, 10, "fail")), true);
  assert.equal(await channel.acceptUpdate(update(2, 10, "retry")), true);
  assert.equal(calls, 2);
  assert.ok(sent.some((item) => item.chatId === 10 && item.text.includes("intentional tool failure")));
  assert.ok(sent.some((item) => item.chatId === 10 && item.text === "recovered"));
});

test("different Telegram chats run concurrently without mixing responses", async () => {
  const sent: Array<{ chatId: number; text: string }> = [];
  let active = 0;
  let maxActive = 0;
  const agent = {
    async run(message: string, options?: AgentRunOptions): Promise<AgentRunResult> {
      active++;
      maxActive = Math.max(maxActive, active);
      options?.onStatus?.("thinking", "orchestrator:test/general");
      await new Promise((resolve) => setTimeout(resolve, 25));
      active--;
      return { sessionId: message, response: `reply:${message}`, toolCallsExecuted: [] };
    },
  };
  const channel = new TelegramChannel("test-token", [], {
    agent,
    fetch: fakeTelegramFetch(sent),
    voiceReplies: false,
  });

  await Promise.all([
    channel.acceptUpdate(update(1, 10, "alpha")),
    channel.acceptUpdate(update(2, 20, "beta")),
  ]);
  assert.equal(maxActive, 2);
  assert.ok(sent.some((item) => item.chatId === 10 && item.text === "reply:alpha"));
  assert.ok(sent.some((item) => item.chatId === 20 && item.text === "reply:beta"));
  assert.equal(sent.some((item) => item.chatId === 10 && item.text === "reply:beta"), false);
  assert.equal(sent.some((item) => item.chatId === 20 && item.text === "reply:alpha"), false);
});

test("requests from one Telegram chat stay sequential", async () => {
  const sent: Array<{ chatId: number; text: string }> = [];
  const order: string[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const agent = {
    async run(message: string): Promise<AgentRunResult> {
      order.push(`start:${message}`);
      if (message === "first") await firstGate;
      order.push(`end:${message}`);
      return { sessionId: message, response: `reply:${message}`, toolCallsExecuted: [] };
    },
  };
  const channel = new TelegramChannel("test-token", [], {
    agent,
    fetch: fakeTelegramFetch(sent),
    voiceReplies: false,
  });

  const first = channel.acceptUpdate(update(1, 10, "first"));
  await new Promise((resolve) => setTimeout(resolve, 5));
  await channel.acceptUpdate(update(2, 10, "second"));
  assert.deepEqual(order, ["start:first"]);
  releaseFirst?.();
  await first;
  for (let i = 0; i < 20 && !sent.some((item) => item.text === "reply:second"); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.deepEqual(order, ["start:first", "end:first", "start:second", "end:second"]);
});
