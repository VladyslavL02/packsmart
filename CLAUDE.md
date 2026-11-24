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
- Prefer named exports
- Keep the packing engine in `src/engine/` as pure logic, with no React or network imports
- Validate external data (Open-Meteo, Gemini, Supabase rows) with Zod
- Colors use the Tailwind theme tokens from `design-ref/palette.md` (already adjusted for Tailwind), not raw palette classes like `zinc-*` or `emerald-*`
- Icons use Lucide, not Material Symbols

# Git
- Never push to or open PRs against `main`
- Open PRs into `develop`
