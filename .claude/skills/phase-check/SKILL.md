---
name: phase-check
description: "Run PackSmart's quality gate (npm typecheck, Vitest tests, ESLint and the Supabase security advisors) and print a pass/fail table ending in READY or NOT READY. Use at the end of every development phase, before committing a finished feature, before opening or updating a PR into develop, before deploying, and when the user asks 'is everything green', 'run all checks', 'are we ready to commit/merge/ship' or 'check the project'. It only reports and never fixes anything, so fix the failures afterwards and run it again. Permissive-RLS advisor warnings are expected and marked accepted."
allowed-tools: Bash(npm run typecheck), Bash(npm test), Bash(npm run lint), mcp__supabase__get_advisors
model: haiku
---

# Phase check

Run the quality gate and report. Do not fix anything.

1. Run each of these, and keep going even if one fails:
   - `npm run typecheck`
   - `npm test`
   - `npm run lint`
2. Call `mcp__supabase__get_advisors` with type `security`. If the Supabase MCP is unavailable, mark this check "skipped".
3. Print a table:

   | Check | Result | Detail |
   |---|---|---|
   | typecheck | pass/fail | one line |
   | tests | pass/fail | e.g. "24 passed" or the first failing test |
   | lint | pass/fail | one line |
   | advisors | pass/fail/skipped | one line |

   Under the table, list each failure as `file:line: message`.
   Advisor warnings about permissive RLS policies (`using (true)`) are expected, because access is by unguessable link and that's documented in the README. Mark them "accepted" and don't count them as failures.
4. End with exactly one line: `READY` if every check passed (or was accepted), otherwise `NOT READY`.
