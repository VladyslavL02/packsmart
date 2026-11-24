#!/usr/bin/env bash
# PreToolUse guard: block tool calls whose input mentions a .env file.
# Matches ".env" as a standalone token (e.g. ".env", ".env.local", "./.env*"),
# not "import.meta.env" or "process.env".
input=$(cat)
if printf '%s' "$input" | grep -Eq '(^|[^A-Za-z0-9_])\.env([^A-Za-z0-9_]|$)'; then
  echo "Blocked: .env files are off-limits. Ask the user for the values instead." >&2
  exit 2
fi
exit 0
