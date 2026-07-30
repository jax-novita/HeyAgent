---
name: autonomous-execution
description: |
  Persistent PLAN→EXECUTE→VERIFY→RECOVER loop for computer tasks.
  USE WHEN: multi-step desktop/browser/file work, anything that can fail mid-way.
  DO NOT USE FOR: pure chat questions with no side effects.
tools:
  - screen.see
  - ui.tree
  - ui.find
  - computer.click
  - computer.type
  - computer.hotkey
  - shell.exec
  - file.exists
---

# Autonomous execution

## Protocol
1. **PLAN** — numbered steps with expected outcome each.
2. **EXECUTE** — one meaningful tool action (prefer API/file/shell over UI).
3. **VERIFY** — screenshot / `file_exists` / URL / tool output must match intent.
4. **RECOVER** — on fail, diagnose; up to 3 alternatives; then escalate.
5. **FINISH** — report only verified paths/URLs; never invent DONE.

## Examples
- input: «открой блокнот и напиши рассказ о мальчике»
  tools: notepad.write content=проза-рассказ title=rasskaz_o_malchike destination=desktop
  never: short rhyme / файл «стишок»

- input: «открой мне дым сигарет с ментолом»
  tools: youtube.open.lesson mode=quick → first organic match
  never: scroll past the correct top video

- input: «пройди тест на вкладке»
  tools: browser.tabs.list → focus → answer → verify → Next (never Next blind)

Never stop after the first tool failure. Ask the owner only for CAPTCHA, login, payment, or irreversible choice.
