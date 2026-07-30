---
name: weather
description: Current weather via wttr.in (OpenClaw-compatible pattern)
tools:
  - weather.get
  - web.fetch
---

# Weather

Prefer `weather.get` with a city name (e.g. Moscow, London).

Fallback: `web.fetch` → `https://wttr.in/Moscow?format=j2`
