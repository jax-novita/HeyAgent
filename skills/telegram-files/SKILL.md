---
name: telegram-files
description: Send files via Telegram Desktop to contacts or Bot API to owner
tools:
  - telegram.file
  - telegram.document
  - telegram.photo
  - telegram.message
  - file.download
  - paths.downloads
---

# Telegram files

- To a **person** (Ренат): `telegram_file` with contact + filePath (+ optional caption)
- To **yourself** (control bot): `telegram_document` / `telegram_photo`
- Text only: `telegram_message`
- Download first if needed: `file_download` → then send
