import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAnthropicChatResponse,
  parseOpenAIChatResponse,
} from "./index.js";

const invalidStructuredOutputs: unknown[] = [
  null,
  {},
  { action: null },
  { tool: "unknown.tool", args: null },
  { type: "tool_call" },
  "plain text",
];

for (const value of invalidStructuredOutputs) {
  test(`OpenAI response validation rejects ${JSON.stringify(value)}`, () => {
    assert.throws(
      () => parseOpenAIChatResponse(value, "test-model", "test-provider"),
      /Invalid test-provider model response/,
    );
  });
}

test("OpenAI response validation normalizes null and malformed tool args", () => {
  const result = parseOpenAIChatResponse(
    {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: "a", function: { name: "shell_exec", arguments: "null" } },
              { id: "b", function: { name: "file_read", arguments: "{bad" } },
              { id: "c", function: { name: "", arguments: "{}" } },
              null,
            ],
          },
        },
      ],
    },
    "test-model",
    "test-provider",
  );
  assert.equal(result.content, "");
  assert.deepEqual(result.toolCalls?.map((call) => call.arguments), [{}, {}]);
  assert.deepEqual(result.toolCalls?.map((call) => call.name), ["shell_exec", "file_read"]);
});

test("Anthropic response validation normalizes null tool input", () => {
  const result = parseAnthropicChatResponse(
    {
      content: [
        { type: "text", text: "ok" },
        { type: "tool_use", id: "a", name: "shell_exec", input: null },
      ],
    },
    "test-model",
    "anthropic",
  );
  assert.equal(result.content, "ok");
  assert.deepEqual(result.toolCalls?.[0]?.arguments, {});
});

test("Anthropic response validation rejects missing content", () => {
  assert.throws(
    () => parseAnthropicChatResponse({}, "test-model", "anthropic"),
    /Invalid anthropic model response/,
  );
});
