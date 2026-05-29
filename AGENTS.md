<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Project overview

Garmin Connect dashboard that caches activity data in SQLite and displays it. On server startup, `instrumentation.ts` initializes the DB and starts a background full-history sync; after that it refreshes once daily.

## Commands

- **Install**: `bun install` — Bun is the package manager (not npm/yarn/pnpm)
- **Dev**: `bun run dev`
- **Build**: `bun run build`
- **Production start**: `bun run start`
- **Lint**: `bun run lint` (flat ESLint config with Next.js core-web-vitals + TypeScript)

No test framework or test scripts are configured.

## Architecture

- `app/` — Next.js App Router pages and API routes
  - `page.tsx` — dashboard (reads SQLite cache + live training-load)
  - `/api/activities/route.ts` — cached activities JSON
  - `/api/training-load/route.ts` — live training load JSON (proxies Garmin Connect)
  - `/embed/running/page.tsx` — embeddable current-month running view
- `lib/garmin.ts` — Garmin Connect client, activity/training-load fetching, domain validation
- `lib/activity-cache.ts` — SQLite cache layer using `node:sqlite` (`DatabaseSync`)
- `lib/activity-sync.ts` — background sync logic (initial backfill + daily incremental refresh)
- `lib/activity-sync-scheduler.ts` — `setTimeout`-based daily scheduler, triggered from `instrumentation.ts`

All route handlers and pages use `runtime = "nodejs"` and `dynamic = "force-dynamic"` because they depend on SQLite and/or the Garmin API.

## Key details

- **Next.js 16.x** — breaking changes from earlier versions; consult `node_modules/next/dist/docs/` before assuming API behavior.
- **SQLite via `node:sqlite`** — uses the built-in `DatabaseSync` class, not a third-party package. A type declaration lives at `node-sqlite.d.ts` in the project root.
- **Tailwind CSS v4** — uses `@import "tailwindcss"` and `@tailwindcss/postcss`, not a `tailwind.config.*` file.
- **Path alias** `@/*` maps to the project root (`./*`), not `src/*`.
- **Env vars**: `GARMIN_USERNAME` and `GARMIN_PASSWORD` are required. `GARMIN_DOMAIN` accepts only `"garmin.com"` or `"garmin.cn"` (validated in code). `GARMIN_DB_PATH` and `GARMIN_SYNC_TIME` are optional.
- **SQLite data** is stored in `.data/garmin.sqlite` by default, which is gitignored.
- **Linux deploy**: `scripts/setup-linux.sh` handles Node/Bun install, `.env` creation, `bun install --frozen-lockfile`, `bun run build`, and optional systemd service setup.