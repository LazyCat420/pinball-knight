#!/usr/bin/env bash
# Quick launcher to play Pinball Knight on the Windows Desktop.
# Usage:
#   ./play.sh              # Normal boot (Intro -> Tavern -> Dungeon)
#   ./play.sh --tavern     # Boot straight into Tavern Hub
#   ./play.sh --dungeon    # Boot straight into Dungeon floor
#   ./play.sh --release    # Run optimized release build (smooth 60 FPS)
set -euo pipefail
cd "$(dirname "$0")"
exec ./scripts/pk-win.sh run "$@"
