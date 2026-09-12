# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- Install dependencies: `npm install` (runs `prisma generate` via `postinstall`)
- Build (TypeScript -> `dist/`): `npm run build`
- Run in dev mode (auto-restart): `npm run dev`
- Start built server: `npm start`
- Lint: `npm run lint`
- Run all tests: `npm test` (requires `DATABASE_URL` pointing at a reachable Postgres with
  migrations applied — see Database below)
- Run a single test file: `npx jest tests/market.test.ts`
- Run a single test by name: `npx jest -t "creates, fetches, updates, and deletes an item"`
- Create/apply a new migration during development: `npm run prisma:migrate`
- Apply existing migrations without prompting (CI/prod): `npm run prisma:migrate:deploy`

## Database

Backed by PostgreSQL via Prisma. Copy `.env.example` to `.env` and point `DATABASE_URL` at a
running Postgres instance, then run `npm run prisma:migrate` to create the schema (a
`market_items` table backing the `MarketItem` model in `prisma/schema.prisma`). Tests use the
same `DATABASE_URL` and wipe the `MarketItem` table between test cases (`beforeEach` in
`tests/market.test.ts`) — point it at a disposable/test database, not one with real data. CI
spins up a `postgres:16` service container and runs `prisma migrate deploy` before testing (see
`.github/workflows/ci.yml`).

## Architecture

Node.js/TypeScript/Express backend API for the "market" feature. Layout follows a standard
route -> controller -> service pattern:

- `src/app.ts` — builds the Express app (middleware, route mounting, a catch-all error handler
  that returns 500 on unhandled errors). Exported separately from `src/index.ts` so tests can
  import the app without binding a port.
- `src/index.ts` — process entry point; starts the HTTP server (`PORT` env var, default 3000) and
  disconnects Prisma on `SIGINT`/`SIGTERM`.
- `src/db/prisma.ts` — the shared `PrismaClient` instance; import this rather than instantiating
  a new client elsewhere.
- `src/routes/market.routes.ts` — maps HTTP verbs/paths under `/api/market/items` to controller
  functions, wrapped in `asyncHandler` (`src/utils/asyncHandler.ts`) so rejected promises reach
  the error-handling middleware instead of crashing silently.
- `src/controllers/market.controller.ts` — parses/validates request data, calls the service layer,
  shapes HTTP responses/status codes.
- `src/services/market.service.ts` — business logic and data access, backed by Prisma
  (`prisma.marketItem`). This is the layer to touch if the persistence approach changes; the
  controller/route layers don't need to know it's Postgres.
- `src/types/market.types.ts` — shared TypeScript types for the market domain: re-exports the
  Prisma-generated `MarketItem` type and defines create/update input shapes.
- `prisma/schema.prisma` — the `MarketItem` model and datasource config; `prisma/migrations/`
  holds the generated SQL migrations (commit these alongside schema changes).

Tests (`tests/market.test.ts`) use `supertest` against the app built by `createApp()` and hit the
real database configured by `DATABASE_URL` — they don't start a real network listener, but they
are integration tests, not pure unit tests.
