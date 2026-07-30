---
name: accurate-clock
description: Use OS clock for time/date — never invent «сейчас»
---

# Accurate clock

LLMs invent dates and times. Always use the OS clock.

## When

- «который час», «какая дата», «сколько времени»
- расписание, «через N часов/дней», дедлайны
- любые упоминания «сейчас» / «сегодня» в точных задачах

## How

1. Call `clock_now` (tool `clock.now`).
2. Optional: `timezone` (IANA, e.g. `Europe/Moscow`), `addHours` / `addDays` / `addMinutes`.
3. Report the returned values — do not recalculate in your head.

Config (optional):

- `timezone` in heyagent config
- `features.accurateClock: false` to disable injection + fast path
