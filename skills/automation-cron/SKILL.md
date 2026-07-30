---
name: automation-cron
description: Schedule recurring agent tasks (OpenClaw cron parity)
tools:
  - cron.schedule
  - cron.list
  - cron.cancel
---

# Cron automation

Gateway must be running (`hey gateway start`).

Example: every 60 minutes check weather and notify:
`cron_schedule` name=weather prompt="проверь погоду в Москве и кратко отчитайся" everyMinutes=60
