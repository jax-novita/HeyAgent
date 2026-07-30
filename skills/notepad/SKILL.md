---
name: notepad
description: |
  Create/open text in Notepad reliably.
  USE WHEN: блокнот, напиши файл, рассказ/стих/список на диск.
  DO NOT USE notepad.type for saving — it drops characters and does not save.
tools:
  - notepad.write
  - file.write
  - app.open
---

# Notepad

Always prefer `notepad.write` (writes disk → opens Notepad → verified bytes).

## Examples
- «создай файл в блокноте и напиши рассказ о маленьком мальчике»
  → prose story, title like `rasskaz_o_malchike`, destination=desktop
  → NEVER a short rhyme / `стишок.txt`

- «открой блокнот и напиши список покупок»
  → genre=list, short bullets

Genre must match the request. Filename from topic, not from tool examples.
