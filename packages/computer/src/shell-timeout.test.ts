import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runShell } from "./index.js";

test("runShell times out and terminates the spawned process tree", async () => {
  const dir = await mkdtemp(join(tmpdir(), "heyagent-shell-timeout-"));
  const script = join(dir, "hang.cjs");
  const pidFile = join(dir, "pid.txt");
  await writeFile(
    script,
    [
      "const { writeFileSync } = require('node:fs');",
      `writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
      "setInterval(() => {}, 1000);",
    ].join("\n"),
    "utf8",
  );

  try {
    await assert.rejects(
      runShell(`node "${script}"`, undefined, 300),
      /timed out after 300ms/i,
    );
    const pid = Number(await readFile(pidFile, "utf8"));
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.throws(() => process.kill(pid, 0));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
