#!/bin/bash
# Runs at every session start, local and cloud. Cloud-only work is gated below.
# Must always exit 0 — a non-zero exit here blocks the session from starting.
set -u

# Dependencies. No-op once node_modules exists, so local sessions pay nothing.
if [ ! -d "$CLAUDE_PROJECT_DIR/node_modules" ]; then
  npm ci --prefix "$CLAUDE_PROJECT_DIR" 2>/dev/null \
    || npm install --prefix "$CLAUDE_PROJECT_DIR" \
    || true
fi

# Everything past here is cloud-only.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

# With NOTION_KEYRING=0, ntn reads ~/.config/notion/auth.json. The cloud
# environment's setup script runs as root, so if the session itself runs as a
# different user that file lands in the wrong home. This hook runs as the
# session user, so writing it here is authoritative.
if [ -n "${NTN_AUTH_JSON:-}" ] && [ ! -s "$HOME/.config/notion/auth.json" ]; then
  mkdir -p "$HOME/.config/notion"
  printf '%s' "$NTN_AUTH_JSON" > "$HOME/.config/notion/auth.json"
  chmod 600 "$HOME/.config/notion/auth.json"
fi

exit 0
