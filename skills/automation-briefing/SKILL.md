---
name: automation-briefing
description: Daily briefing — news + mail + calendar → PDF → Telegram; schedule via cron
---

# Briefing

Say «собери брифинг» / «утренний брифинг» → harness `briefing.compose`:

1. News digest (research)
2. Gmail summary (if connected)
3. Google Calendar today (if OAuth/API available)
4. One PDF → send to Telegram owner

## Daily schedule

«напоминай каждый день в 9:00 собрать брифинг» → cron `daily` at local time.
Gateway must be running for cron ticks.
