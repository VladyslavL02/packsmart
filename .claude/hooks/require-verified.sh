#!/usr/bin/env bash
# PreToolUse gate for Bash: block `git commit` until the change-verifier agent
# has returned VERDICT: OK TO COMMIT for the exact current diff.
set -uo pipefail
dir="$(dirname "$0")"

cmd=$(jq -r '.tool_input.command // ""' 2>/dev/null)
printf '%s' "$cmd" | grep -Eq '(^|[;&|[:space:]])git[[:space:]]+commit([[:space:]]|$)' || exit 0

marker="$dir/../.verified-diff"
if [ -f "$marker" ] && [ "$(cat "$marker")" = "$("$dir/diff-hash.sh")" ]; then
  exit 0
fi

echo "Blocked: run the change-verifier agent on the current diff (pass the user's request as intent) and get VERDICT: OK TO COMMIT before committing. The diff changed or was never verified." >&2
exit 2
