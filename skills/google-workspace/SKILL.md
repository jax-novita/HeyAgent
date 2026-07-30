---
name: google-workspace
description: Google Docs, Drive, Gmail, Sheets, and Calendar integration for HeyAgent
auth: oauth2
env:
  - GOOGLE_ACCESS_TOKEN
tools:
  - google.docs.read
  - google.docs.write
  - google.drive.search
  - gmail.draft
  - gmail.send
setup: hey connect google
---

# Google Workspace Skill

Connect with `hey connect google`.

Scopes: Documents, Drive, Gmail compose/send, Calendar, Sheets.
