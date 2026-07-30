---
name: research-report
description: Analyze websites and write structured PDF/HTML reports (OpenClaw research + HeyAgent digest)
tools:
  - web.search
  - web.analyze
  - web.fetch
  - web.links
  - report.write
  - telegram.document
  - file.download
---

# Research & reports

1. Prefer harness `research.digest` for «новости / дайджест / pdf отчёт» (deterministic).
2. Or: `web.search` → `web.analyze` on top URLs.
3. `report.write` with `format=pdf` (styled HTML→PDF) or html/md. Body: `##` section headings.
4. Optionally `telegram.document` to deliver the file.
5. Heartbeat/cron can trigger digests in the background while gateway runs.
