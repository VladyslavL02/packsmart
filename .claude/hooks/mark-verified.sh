#!/usr/bin/env bash
# Called by the change-verifier agent, only after VERDICT: OK TO COMMIT.
# Records the hash of the verified diff so require-verified.sh lets the commit through.
set -uo pipefail
dir="$(dirname "$0")"
"$dir/diff-hash.sh" > "$dir/../.verified-diff" && echo "Marked current diff as verified."
