---
name: app-installer
description: Find, install, verify, and uninstall desktop programs
tools:
  - app.search
  - app.install
  - app.uninstall
  - app.open
  - screen.see
---

# Program installation

For «установи программу X»:

1. If the package ID is unknown, call `app_search`.
2. Select the official/exact package, then call `app_install`.
3. Trust success only when the tool says `INSTALLED and verified`.
4. Optionally call `app_open` and inspect with `screen_see`.
5. If one manager fails, let the tool try available package managers; report the exact error.

Do not merely download an installer and claim the app is installed.
