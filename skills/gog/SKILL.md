---
name: gog
description: "Google Workspace via gogcli (OpenClaw-compatible): Gmail, Calendar, Drive, Contacts, Sheets, Docs."
homepage: https://gogcli.sh
metadata:
  {
    "heyagent":
      {
        "emoji": "🎮",
        "requires": { "bins": ["gog"] },
        "install":
          [
            {
              "id": "winget",
              "kind": "winget",
              "package": "steipete.gogcli",
              "bins": ["gog"],
              "label": "Install gog (winget)",
            },
          ],
      },
  }
---

# gog (OpenClaw path)

HeyAgent использует `gog` так же, как OpenClaw — OAuth и API Google через gogcli, не через самописный Web redirect.

## Setup (once)

```bash
npx hey connect google
```

Или вручную:

```bash
gog auth credentials set /path/to/client_secret.json
gog auth add you@gmail.com --services gmail,calendar,drive,contacts,docs,sheets
gog auth list
```

Важно: в Google Cloud создай **Desktop app** OAuth client (не Web application), иначе будет `redirect_uri_mismatch`.

## Agent tools

- Для «проверь почту» / «кто написал» — сразу `gmail.summary` (внутри вызывает gog).
- Не открывай браузер Gmail ради чтения писем.

## Common gog commands

- `gog gmail search 'newer_than:7d' --max 10`
- `gog gmail messages search "in:inbox" --max 20 --json`
- `gog gmail send --to a@b.com --subject "Hi" --body "Hello"`
- `gog calendar events primary --today`
- `gog drive search "query" --max 10`
- `gog contacts list --max 20`
- `gog sheets get <sheetId> "Tab!A1:D10" --json`
- `gog docs cat <docId>`
