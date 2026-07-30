import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  adaptMessagesForModel,
  modelSupportsImages,
  resolveMaxTokensField,
} from "./providers.js";

describe("maxTokensField (OpenClaw compat)", () => {
  it("uses max_completion_tokens for openai / o3-mini", () => {
    assert.equal(
      resolveMaxTokensField("openai", "o3-mini", { maxTokensField: "max_completion_tokens" }, {
        maxTokensField: "max_completion_tokens",
      }),
      "max_completion_tokens",
    );
  });

  it("uses max_tokens for mistral", () => {
    assert.equal(resolveMaxTokensField("mistral", "mistral-large-latest"), "max_tokens");
  });

  it("uses max_tokens for bedrock", () => {
    assert.equal(resolveMaxTokensField("bedrock", "amazon.nova-lite-v1:0"), "max_tokens");
  });

  it("model compat overrides provider", () => {
    assert.equal(
      resolveMaxTokensField("custom", "x", { maxTokensField: "max_tokens" }, {
        maxTokensField: "max_completion_tokens",
      }),
      "max_completion_tokens",
    );
  });
});

describe("image modality compatibility", () => {
  const messages = [{
    role: "user" as const,
    content: "Inspect the screen",
    images: [{ mimeType: "image/png", data: "AAAA", detail: "high" as const }],
  }];

  it("strips images for text-only Bedrock fallback models", () => {
    for (const model of ["qwen.qwen3-coder-next", "deepseek.v3.1", "openai.gpt-oss-20b"]) {
      const adapted = adaptMessagesForModel({ provider: "bedrock", model }, messages);
      assert.equal(adapted[0]?.images, undefined, model);
      assert.match(adapted[0]?.content ?? "", /omitted.*text input only/i);
    }
  });

  it("keeps images for known vision models", () => {
    const ref = { provider: "openai", model: "gpt-4.1" };
    assert.equal(modelSupportsImages(ref), true);
    assert.equal(adaptMessagesForModel(ref, messages), messages);
  });
});
