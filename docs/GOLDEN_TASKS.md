# Golden task test plan

Run manually on Windows, macOS, and Linux after `hey onboard` and `hey gateway start`.

## Computer (extended)

9. Download a file from URL to Downloads
10. Analyze a website and write a report to Documents/HeyAgent-Reports
11. Send a local file to a Telegram contact
12. Deliver report to owner via telegram.document
13. Schedule cron job + verify gateway ticker
14. Zip/unzip a folder
15. code.run a short node snippet

## Computer (8 tasks)

1. `hey ask "list files in current directory"` — uses file.list
2. `hey ask "create a file ~/heyagent-test.txt with hello"` — file.write
3. `hey ask "read ~/heyagent-test.txt"` — file.read
4. `hey ask "run echo hello in terminal"` — shell.exec
5. `hey ask "open https://example.com"` — browser.open
6. Deny destructive shell — policy asks approval
7. Desktop screenshot command returns path/message
8. Session persists across `hey chat` messages

## Integrations (8 tasks)

1. `hey connect notion` + `hey integrations status` shows connected
2. `hey connect google` + status shows connected
3. `hey ask "search notion for roadmap"` — notion.search
4. `hey ask "create notion page titled Test"` — notion.write (with approval)
5. Google Drive search by query
6. Create Google Doc with summary text
7. Gmail draft (not send without approval)
8. `hey connect github` + create test issue

## Channels

1. Telegram setup + pair + message bot
2. Desktop tray connects to gateway /health
3. CLI and Telegram share session memory (same gateway)

## Models

1. `hey models auth openai` + `hey models test`
2. `hey models set ollama/llama3.2` (if Ollama running)
3. Onboard smoke-test passes

## Autonomy and recovery

1. Open Notepad, write text and verify the saved file.
2. Find an already-open browser tab and collect requested information.
3. Message a Telegram contact, enter a persisted wait and resume on reply.
4. Restart the gateway while waiting and verify the write is not repeated.
5. Find a product within a budget and compare at least three options.
6. Add the selected product to a cart without purchasing.
7. Prepare a hotel booking and request an immutable approval preview.
8. After approval, commit once and record the confirmation number.
9. Change the final price and verify the previous approval becomes invalid.
10. Amend the current mission budget without repeating completed actions.
11. Recover from an unexpected modal dialog and record the strategy/evidence.
12. Run on two monitors with negative coordinates and mixed DPI.
13. Create and test a draft skill without activating it automatically.

For each run record: task success, verified success, false-done result,
recovery attempts, user interventions, restart/resume result, duplicate write
count, elapsed time and evidence paths.
