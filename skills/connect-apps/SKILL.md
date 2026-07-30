---
name: connect-apps
description: Multi-service connector (Google, Notion, GitHub, Obsidian)
tools:
  - apps.connect
  - google.docs.write
  - notion.write
  - github.issue.create
setup:
  - hey connect google
  - hey connect gmail
  - hey connect notion
  - hey connect github
---

# Connect apps

Use `apps.connect` with:
- service: google | notion | github | obsidian
- action: docs.create | search | write | issue.create | ...
- payload: { title, content, query, repo, ... }

`hey connect google` authorizes Docs, Drive, Sheets, Slides, and Calendar through
browser OAuth. Gmail is intentionally separate: `hey connect gmail` uses a
Google App Password and requires 2FA.

Or call dedicated tools after `hey connect <service>`.
