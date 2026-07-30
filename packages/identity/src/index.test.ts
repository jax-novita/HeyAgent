import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateAgentName, buildSystemPrompt, isValidAvatarId } from "./types.js";

describe("identity", () => {
  it("validates names", () => {
    assert.equal(validateAgentName("P"), "Name must be at least 2 characters.");
    assert.equal(validateAgentName("Pixel"), null);
    assert.equal(validateAgentName("a".repeat(30)), "Name must be 24 characters or fewer.");
  });

  it("validates avatars", () => {
    assert.ok(isValidAvatarId("sprite-04"));
    assert.ok(!isValidAvatarId("invalid"));
  });

  it("builds system prompt with name", () => {
    const prompt = buildSystemPrompt({
      name: "Pixel",
      avatarId: "sprite-04",
      persona: "engineer",
      createdAt: new Date().toISOString(),
    });
    assert.ok(prompt.includes("Pixel"));
    assert.ok(prompt.includes("HeyAgent"));
  });

  it("localizes presentation without receiving or rewriting user input", () => {
    const identity = {
      name: "Пиксель",
      avatarId: "sprite-04",
      persona: "engineer",
      createdAt: new Date().toISOString(),
    };
    const prompt = buildSystemPrompt(identity, "ru");
    assert.ok(prompt.includes("Пиксель"));
    assert.ok(prompt.includes("Никогда не переводи"));
    assert.equal(validateAgentName("Я", "ru"), "Имя должно содержать не менее 2 символов.");
  });
});
