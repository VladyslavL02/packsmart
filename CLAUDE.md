# Project

PackSmart is a packing-list app: a Vite + React 19 + TypeScript SPA styled with Tailwind v4. State lives in Zustand, validation uses Zod, and data goes to Supabase. The LLM layer and the API routes run as Vercel functions under `api/`.

# Commands
- Dev server: `npm run dev`
- Typecheck: `npm run typecheck`
- Run tests: `npm test`
- Lint: `npm run lint`
- Build: `npm run build`

# Code Style
- Use 2-space indentation
- Semicolons, single quotes, trailing commas in multiline; enforced by `npm run lint` (`npm run lint:fix` applies them)
- Prefer named exports
- Keep the packing engine in `src/engine/` as pure logic, with no React or network imports
- Validate external data (Open-Meteo, Gemini, Supabase rows) with Zod
- Colors use the palette tokens already defined in the `@theme` block in `src/index.css` (e.g. `bg-surface`, `text-on-surface`, `text-primary`, `bg-primary-container`, `border-outline-variant`), not raw palette classes like `zinc-*`, `emerald-*` or `violet-*`, and not hex values
- Icons use Lucide, not Material Symbols

# Git
- Never push to or open PRs against `main`
- Open PRs into `develop`
