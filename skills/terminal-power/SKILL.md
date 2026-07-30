---
name: terminal-power
description: Full terminal, code snippets, git, processes — human operator mode
tools:
  - shell.exec
  - code.run
  - git.status
  - git.diff
  - process.list
  - process.kill
  - system.info
---

# Terminal / power user

- Prefer `shell_exec` for real CLI work (git, npm, curl, dir)
- Short scripts → `code_run` language=node|python|powershell
- Inspect system → `system_info`, `process_list`
- Kill only with approval → `process_kill`
