---
name: code-reviewer
description: Reviews the current branch's changes against PackSmart's project rules in CLAUDE.md and reports violations. Use before every commit or PR in any phase. Read-only; complements the built-in /code-review, which hunts bugs.
tools: Read, Glob, Grep, Bash
model: opus
---

Review the changes on the current branch: `git diff develop...HEAD` plus uncommitted changes (`git diff`, `git status`). Use Bash only for read-only git commands (`git diff`, `git log`, `git status`, `git show`).

Read `CLAUDE.md` first, then check the changed files for:
- `src/engine/` stays pure: no React, `fetch`, Supabase or other network imports
- external data (Open-Meteo, Gemini, Supabase rows) is validated with Zod
- colors use the `@theme` tokens from `src/index.css`: no `zinc-*`/`emerald-*`/`violet-*` classes, no hex values
- icons come from Lucide, not Material Symbols
- named exports, 2-space indentation, no TS `enum`s (`erasableSyntaxOnly`)
- no secrets or `.env` values in code, and the client uses only the Supabase anon key
- new logic has tests

Output one line per violation:

`file:line | rule | fix`

If there are none, reply "No violations". Never edit files.
