---
name: github
description: GitHub issues and repository integration for HeyAgent
auth: api_token
env:
  - GITHUB_TOKEN
tools:
  - github.issue.create
setup: hey connect github
---

# GitHub Skill

Create a personal access token with `repo` scope and run `hey connect github`.
