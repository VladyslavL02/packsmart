---
name: add-trip-preset
description: "Add a new trip type/preset to PackSmart end to end. It appends the type to TRIP_TYPES in src/engine/types.ts, adds its packing rules (stable keys, scope, quantity, reason) to TRIP_TYPE_RULES in src/engine/rules.ts, adds a generator test, and adds the option card in the trip-type picker once the UI exists. Then it runs typecheck and tests. Use whenever the user wants a new kind of trip, e.g. 'add a ski trip', 'support camping', 'new preset for festivals/road trip/cruise/hiking', or 'add a trip type'. Do NOT use it to add a single item or rule to an existing trip type, or to change weather or luggage logic; edit rules.ts directly for those."
argument-hint: <name> "<comma-separated items>"
allowed-tools: Read, Glob, Grep, Edit, Write, Bash(npm run typecheck), Bash(npm test)
model: sonnet
---

# Add a trip preset

Arguments: $ARGUMENTS. The first word is the trip type name (lowercase, e.g. `ski`). The rest is an optional list of items. If no items are given, pick 3–6 sensible ones for that kind of trip.

1. **Type:** append the name to `TRIP_TYPES` in `src/engine/types.ts`.
2. **Rules:** add its `Rule[]` entry to `TRIP_TYPE_RULES` in `src/engine/rules.ts`.
   - Every rule needs a stable, unique `key` (e.g. `ski-goggles`). Check that no existing rule already uses it.
   - Pick the scope: `everyone` for personal gear, `shared` for one-per-group items, `adult`/`child` only when it really differs.
   - Scale quantities with trip length when it makes sense, and give each rule a short `reason`.
3. **Test:** add one `it` to `src/engine/generator.test.ts` asserting that the new items appear for that trip type and don't appear for another type.
4. **UI:** if the trip-type picker exists (search `src/` for the existing trip types' labels), add an option card that matches the existing cards. Use a Lucide icon and `@theme` color tokens only. If the picker doesn't exist yet, skip this step and say so.
5. Run `npm run typecheck` and `npm test`. Fix failures caused by your change.
6. Report the changed files and the items added, with their scope and quantity.
