---
name: notion
description: Notion workspace search, read, and write for HeyAgent
auth: api_token
env:
  - NOTION_API_TOKEN
tools:
  - notion.search
  - notion.read
  - notion.write
setup: hey connect notion
---

# Notion Skill

1. Create integration at https://www.notion.so/my-integrations
2. Share pages/databases with the integration
3. Run `hey connect notion` and paste token
