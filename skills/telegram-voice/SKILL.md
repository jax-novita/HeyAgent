---
name: telegram-voice
description: Inbound Whisper STT; outbound ElevenLabs for Telegram notes AND hey chat speakers
---

# Voice — ElevenLabs everywhere

Same ElevenLabs credentials for:

- **Telegram** → voice note in chat
- **`hey chat` / CLI** → play audio on PC speakers (no media-player window)

## Setup

```bash
hey voice key
hey voice on
```

Or in chat: `/voice` → `2` (API) → `1` (toggle).

## Direction

| Direction | Tech |
|-----------|------|
| You → Telegram bot | Whisper STT |
| Agent → Telegram | ElevenLabs → `sendVoice` |
| Agent → `hey chat` | ElevenLabs → speakers |
