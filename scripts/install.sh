#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm install
npm run build
echo ""
echo "HeyAgent installed. Run: npx hey onboard"
