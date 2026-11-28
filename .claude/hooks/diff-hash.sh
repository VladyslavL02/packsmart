#!/usr/bin/env bash
# Print a hash of all uncommitted work: staged + unstaged changes and untracked files.
# Staging (git add) does not change the hash, so verify-then-commit works.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

{
  git diff HEAD
  git ls-files --others --exclude-standard
  git ls-files --others --exclude-standard -z | xargs -0 cat 2>/dev/null
} | shasum | cut -d' ' -f1
