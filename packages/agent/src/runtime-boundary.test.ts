import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { guardRunOptions, verifyConcreteToolOutcome } from "./index.js";

test("AgentRuntime contains exceptions thrown by onStatus callbacks", () => {
  const options = guardRunOptions({
    onStatus: () => {
      throw new Error("broken status transport");
    },
  });
  assert.doesNotThrow(() => options.onStatus?.("working", "test"));
  assert.equal(typeof options.onStatus, "function");
});

test("file.write cannot report success when the expected file is absent", async () => {
  const path = join(tmpdir(), `heyagent-missing-${Date.now()}.txt`);
  assert.equal(
    await verifyConcreteToolOutcome(
      "file.write",
      { path, content: "expected" },
      `Wrote 8 bytes to ${path}`,
    ),
    false,
  );
});

test("file.write is verified against the actual file content", async () => {
  const dir = await mkdtemp(join(tmpdir(), "heyagent-file-verify-"));
  const path = join(dir, "result.txt");
  try {
    await writeFile(path, "actual", "utf8");
    assert.equal(
      await verifyConcreteToolOutcome(
        "file.write",
        { path, content: "actual" },
        `Wrote 6 bytes to ${path}`,
      ),
      true,
    );
    assert.equal(
      await verifyConcreteToolOutcome(
        "file.write",
        { path, content: "different" },
        `Wrote 9 bytes to ${path}`,
      ),
      false,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
