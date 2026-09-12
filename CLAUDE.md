# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- Install dependencies: `npm install` (runs `prisma generate` via `postinstall`)
- Build (TypeScript -> `dist/`): `npm run build`
- Run in dev mode (auto-restart): `npm run dev`
- Start built server: `npm start`
- Lint: `npm run lint`
- Run all tests: `npm test` (requires `DATABASE_URL` and `JWT_SECRET` env vars, and a reachable
  Postgres with migrations applied — see Database below; runs with `--runInBand` since test files
  share one real database and would otherwise race each other)
- Run a single test file: `npx jest tests/market.test.ts` (append `--runInBand` if running
  alongside other suites against the same database)
- Run a single test by name: `npx jest -t "creates, fetches, updates as a regular user, and deletes as an admin"`
- Create/apply a new migration during development: `npm run prisma:migrate`
- Apply existing migrations without prompting (CI/prod): `npm run prisma:migrate:deploy`

## Database

Backed by PostgreSQL via Prisma. Copy `.env.example` to `.env` and point `DATABASE_URL` at a
running Postgres instance, set `JWT_SECRET` to any long random string, then run
`npm run prisma:migrate` to create the schema (`market_items` and `users` tables, backing the
`MarketItem` and `User` models in `prisma/schema.prisma`). Tests use the same `DATABASE_URL` and
wipe the `MarketItem`/`User` tables between test cases (`beforeEach` in `tests/market.test.ts` and
`tests/auth.test.ts`) — point it at a disposable/test database, not one with real data. CI spins
up a `postgres:16` service container and runs `prisma migrate deploy` before testing (see
`.github/workflows/ci.yml`).

## Authentication & authorization

JWT bearer tokens, issued via `POST /api/auth/login` after `POST /api/auth/register`
(`src/services/auth.service.ts`, `src/controllers/auth.controller.ts`). Passwords are hashed with
bcrypt (`bcryptjs`); tokens are signed with `JWT_SECRET` (`src/config.ts`) and carry
`{ sub, email, role }`.

- `src/middleware/auth.middleware.ts` — `authenticate` verifies the `Authorization: Bearer <token>`
  header and populates `req.user`; `authorize(...roles)` gates a route to specific `Role`s
  (`USER` | `ADMIN`) and must run after `authenticate`.
- Every new user registers as `USER`; there is no API path to self-promote to `ADMIN` — grant it
  directly in the database (or via a future admin-only endpoint) when needed.
- Market item routes: listing/reading (`GET`) are public; creating/updating (`POST`/`PATCH`)
  require `authenticate`; deleting (`DELETE`) additionally requires `authorize("ADMIN")`. Follow
  this same `authenticate [, authorize(...)]` pattern when adding new protected routes.

## Pagination, search & filtering

`GET /api/market/items` takes `page` (default 1) and `limit` (default 20, capped at 100) query
params and returns `{ items, pagination: { page, limit, total, totalPages } }` rather than a bare
array — a non-integer or non-positive `page`/`limit` returns 400. It also takes an optional `q`
(case-insensitive substring match against `name` OR `description`) and `minPrice`/`maxPrice`
(inclusive price range; a negative, non-numeric, or inverted min/max returns 400).
`marketService.listItems(page, limit, filters)` (`src/services/market.service.ts`) builds a
`Prisma.MarketItemWhereInput` from the filters, runs `findMany`/`count` in parallel, and returns
`PaginatedResult<T>` (`src/types/market.types.ts`) — follow the same pattern for other list
endpoints added later.

## View count

`MarketItem.viewCount` (default 0) increments by 1 every time `GET /api/market/items/:id` is
called; listing (`GET /api/market/items`) never touches it. `marketService.getItem` does this via
a raw `$executeRaw` update (`src/services/market.service.ts`) rather than
`prisma.marketItem.update`, specifically so it does NOT bump `updatedAt` — that column tracks
content edits (`update`/`create`), not views. If you add another "increment a counter on read"
field, follow the same raw-update approach rather than `update()`, or it will silently start
touching `updatedAt`.

## Favorites (likes)

A `Favorite` join row (`userId` + `marketItemId`, unique together, both `onDelete: Cascade`) backs
per-user liking (`src/services/favorite.service.ts`, `src/controllers/favorite.controller.ts`):

- `POST /api/market/items/:id/favorite` — add (auth required); 201 if newly created, 200 if
  already favorited (idempotent, not an error), 404 if the item doesn't exist.
- `DELETE /api/market/items/:id/favorite` — remove (auth required); 204 if removed, 404 if not
  currently favorited.
- `GET /api/market/items/:id/favorite` — auth required; `{ favorited, favoriteCount }` for the
  current user.
- `GET /api/market/favorites` — auth required; the current user's favorited items, paginated
  (same `{ items, pagination }` shape as the market item list).

Every market item response (list, detail, create, update, and the favorites list above) includes
`favoriteCount`. This is attached via `withFavoriteCount` in `src/services/market.service.ts`,
which shapes a Prisma `include: { _count: { select: { favorites: true } } }` result into
`MarketItemWithFavoriteCount` (`src/types/market.types.ts`) — reuse that helper/type rather than
recomputing the count separately if you add another endpoint that returns market items.

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
- `src/config.ts` — reads/validates process env (e.g. `JWT_SECRET`, `JWT_EXPIRES_IN`); read env
  vars through here rather than `process.env` directly.
- `src/routes/market.routes.ts`, `src/routes/auth.routes.ts`, `src/routes/favorites.routes.ts` —
  map HTTP verbs/paths to controller functions, wrapped in `asyncHandler`
  (`src/utils/asyncHandler.ts`) so rejected promises reach the error-handling middleware instead of
  crashing silently. The item-scoped favorite routes (`/:id/favorite`) live in
  `market.routes.ts`; the "my favorites" list route lives in `favorites.routes.ts`, mounted at
  `/api/market/favorites` in `src/app.ts`.
- `src/middleware/auth.middleware.ts` — `authenticate`/`authorize` (see Authentication section
  above).
- `src/controllers/market.controller.ts`, `src/controllers/auth.controller.ts`,
  `src/controllers/favorite.controller.ts` — parse/validate request data, call the service layer,
  shape HTTP responses/status codes.
- `src/services/market.service.ts`, `src/services/auth.service.ts`,
  `src/services/favorite.service.ts` — business logic and data access, backed by Prisma
  (`prisma.marketItem`, `prisma.user`, `prisma.favorite`). This is the layer to touch if the
  persistence approach changes; the controller/route layers don't need to know it's Postgres.
- `src/types/market.types.ts`, `src/types/auth.types.ts` — shared TypeScript types, re-exporting
  Prisma-generated types (`MarketItem`, `Role`) alongside request input shapes.
- `prisma/schema.prisma` — the `MarketItem`/`User`/`Role`/`Favorite` models and datasource config;
  `prisma/migrations/` holds the generated SQL migrations (commit these alongside schema changes).

Tests (`tests/market.test.ts`, `tests/auth.test.ts`, `tests/favorites.test.ts`) use `supertest`
against the app built by `createApp()` and hit the real database configured by `DATABASE_URL` —
they don't start a real network listener, but they are integration tests, not pure unit tests.
