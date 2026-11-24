---
description: Append 2-3 friction bullets from this session to DEVLOG.md under a Phase heading
argument-hint: "[phase number]"
allowed-tools: Read, Edit, Write
---

Append 2–3 concise bullets to DEVLOG.md under a `## Phase $ARGUMENTS` heading. If no phase number was given, use the phase this session worked on; if that is unclear, ask. If the heading already exists, append under it instead of adding a second one. Only log real friction: bugs, hook blocks, test failures, Playwright catches, or architectural mistakes from this session—skip routine progress or features that worked on the first try.

Use this exact format for every bullet:
- **[Short label]:** What broke or was attempted → Caught by [specific hook / tsc / Vitest / Playwright / manual audit] → How it was fixed.

If nothing actually broke or got caught in this session, say so and don't pad DEVLOG.md.
