#!/usr/bin/env bash
# PostToolUse guard for Edit|Write.
# - .ts/.tsx edits: run `npm run typecheck`
# - .ts/.tsx edits under src/engine/: also run `npx vitest run src/engine`
# On failure, exit 2 so the output is fed back to Claude.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

file=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' 2>/dev/null)
[ -n "$file" ] || exit 0

# Make the path relative to the project root.
rel="${file#"$PWD"/}"

case "$rel" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

out=$(npm run --silent typecheck 2>&1)
if [ $? -ne 0 ]; then
  echo "Typecheck failed after editing $rel:" >&2
  echo "$out" >&2
  exit 2
fi

case "$rel" in
  src/engine/*)
    out=$(npx vitest run src/engine 2>&1)
    if [ $? -ne 0 ]; then
      echo "Engine tests failed after editing $rel:" >&2
      echo "$out" >&2
      exit 2
    fi
    ;;
esac

exit 0
