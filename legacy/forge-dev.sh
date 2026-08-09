#!/usr/bin/env bash
# One-click launcher for the sprite forge panel dev environment.
# Opens http://localhost:5174/forge in your default browser.
set -euo pipefail
cd "$(dirname "$0")"
echo "▶ sprite forge dev server starting…"
echo "  route: http://localhost:5174/forge"
echo "  models: ~/comfy/ComfyUI/models/"
echo "  outputs: sprite-forge/work/comfy/<job>/"
echo ""
# Start the dev server in the background, save its PID
npm run dev &
DEV_PID=$!
trap 'kill $DEV_PID 2>/dev/null; echo "▲ dev server stopped"' EXIT
# Poll for the server to be up, then open the browser (after ~5 seconds)
for i in {1..30}; do
  if curl -s -m 1 http://localhost:5174/forge >/dev/null 2>&1; then
    sleep 1
    if command -v xdg-open >/dev/null 2>&1; then
      xdg-open "http://localhost:5174/forge" 2>/dev/null &
    elif command -v open >/dev/null 2>&1; then
      open "http://localhost:5174/forge" 2>/dev/null &
    fi
    break
  fi
  sleep 1
done
wait $DEV_PID
