#!/usr/bin/env bash
# Cross-platform quickstart for macOS / Linux
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22+ required: https://nodejs.org"
  exit 1
fi

echo "==> npm install"
npm install
echo "==> npm run build"
npm run build

OS="$(uname -s)"
echo ""
echo "Build OK on $OS."
if [ "$OS" = "Darwin" ]; then
  echo "Optional (recommended for UI control):"
  echo "  brew install cliclick"
  echo "  Grant Accessibility to Terminal/iTerm (System Settings → Privacy)."
elif [ "$OS" = "Linux" ]; then
  echo "Optional (recommended for UI control):"
  echo "  sudo apt install xdotool wmctrl xclip espeak-ng brightnessctl"
fi
echo ""
echo "Next:"
echo "  npx hey onboard"
echo "  npx hey models auth groq"
echo "  npx hey gateway start"
echo "  npx hey chat"
