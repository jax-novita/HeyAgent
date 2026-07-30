---
name: gmail-inbox
description: Open Gmail in the browser and compose/reply via real UI. Prefer gmail.browser.* tools.
tools:
  - gmail.browser.open
  - gmail.browser.compose
  - gmail.browser.reply
  - gmail.browser.send
  - gmail.summary
---

# Gmail (browser-first)

1. «проверь почту» / «открой gmail» → `gmail.browser.open` (new tab). Optionally `gmail.summary` if IMAP connected.
2. «напиши письмо на X тема Y текст Z» → `gmail.browser.compose` with to/subject/body. Add send=true only if user says отправь.
3. «ответь …» → `gmail.browser.reply` (Gmail must show the thread; shortcut r).
4. «отправь» → `gmail.browser.send` (Ctrl+Enter).
5. Never claim sent/opened without a tool result.
