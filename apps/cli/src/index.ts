#!/usr/bin/env node
import { enableTerminalColor } from "@heyagent/identity";
import { runCli } from "./cli.js";

enableTerminalColor();

runCli(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
