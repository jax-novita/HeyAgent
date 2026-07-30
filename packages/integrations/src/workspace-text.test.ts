import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeWorkspaceMath, plainWorkspaceText } from "./workspace-text.js";

test("LaTeX-like quantum formulas become readable Unicode", () => {
  assert.equal(
    normalizeWorkspaceMath("\\( \\psi = c\\_1 \\psi\\_1 + c\\_2 \\psi\\_2 \\)"),
    "ψ = c₁ ψ₁ + c₂ ψ₂",
  );
  assert.equal(
    normalizeWorkspaceMath(
      "\\[ \\Delta x \\cdot \\Delta p \\geq \\frac{\\hbar}{2}. \\]",
    ),
    "Δ x · Δ p ≥ ℏ/2.",
  );
});
test("plain Workspace text removes Markdown, rules and math delimiters", () => {
  const text = plainWorkspaceText(
    "**Формула:** \\[ \\Delta x \\cdot \\Delta p \\geq \\frac{\\hbar}{2} \\]\n---",
  );
  assert.equal(text, "Формула: Δ x · Δ p ≥ ℏ/2");
  assert.doesNotMatch(text, /\\|\*\*|---|frac|cdot/);
});
