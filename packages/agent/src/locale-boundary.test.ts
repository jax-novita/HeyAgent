import { test } from "node:test";
import assert from "node:assert/strict";
import { preserveUserMessage } from "@heyagent/shared";
import { prepareDocsCompose } from "./harness/docs-compose.js";

test("locale changes presentation templates but never user input", () => {
  const original = "  Create a report в Google Docs about cryptography?!\n";
  const routed = preserveUserMessage(original);
  const prepared = prepareDocsCompose(
    routed,
    (originalUserMessage) => ({
      originalUserMessage,
      task: {
        action: "create_document",
        destination: "google_docs",
        topic: "Cryptography",
        documentType: "документ",
      },
      corrections: [],
    }),
    "en",
  );

  assert.equal(routed, original);
  assert.equal(prepared.normalized.originalUserMessage, original);
  assert.match(JSON.stringify(prepared.generationMessages), /Write an educational документ/);
  assert.doesNotMatch(JSON.stringify(prepared.generationMessages), /originalUserMessage/);
});
