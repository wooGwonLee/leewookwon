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
  (`tests/market.test.ts`, `tests/auth.test.ts`, `tests/favorites.test.ts`, `tests/reviews.test.ts`,
  `tests/users.test.ts`, `tests/images.test.ts`, `tests/categories.test.ts`) share one real
  database — and, for images, the same `uploads/` directory on disk — and would otherwise race
  each other)
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
- Every new user registers as `USER`. Promoting/demoting a user is admin-only —
  `PATCH /api/users/:id/role` (`src/controllers/user.controller.ts`,
  `src/services/user.service.ts`), body `{ role: "USER" | "ADMIN" }`. 400 on an invalid role value,
  404 if the target user doesn't exist, and — deliberately — 403 if `:id` is the requesting
  admin's own id: an admin cannot change their own role through this endpoint (avoids
  accidentally locking themselves out; use another admin account or edit the database directly).
  `GET /api/users` (admin-only, paginated) lists users to find an id to promote; both endpoints
  strip `passwordHash` from every returned user (`SafeUser` in `src/services/user.service.ts`).
- Market item routes: listing/reading (`GET`) are public; creating/updating (`POST`/`PATCH`)
  require `authenticate`; deleting (`DELETE`) additionally requires `authorize("ADMIN")`. Follow
  this same `authenticate [, authorize(...)]` pattern when adding new protected routes.

## Pagination, search, filtering & sorting

`GET /api/market/items` takes `page` (default 1) and `limit` (default 20, capped at 100) query
params and returns `{ items, pagination: { page, limit, total, totalPages } }` rather than a bare
array — a non-integer or non-positive `page`/`limit` returns 400. It also takes an optional `q`
(case-insensitive substring match against `name` OR `description`), `minPrice`/`maxPrice`
(inclusive price range; a negative, non-numeric, or inverted min/max returns 400), and
`categoryId` (exact match; an unknown/nonexistent id just yields an empty page, not an error —
see Categories below for why filtering doesn't validate the id).
`marketService.listItems(page, limit, filters, sort)` (`src/services/market.service.ts`) builds a
`Prisma.MarketItemWhereInput` from the filters, runs `findMany`/`count` in parallel, and returns
`PaginatedResult<T>` (`src/types/market.types.ts`) — follow the same pattern for other list
endpoints added later.

Sorting: `sortBy` (one of `SORTABLE_FIELDS` in `src/types/market.types.ts` —
`createdAt`/`price`/`viewCount`/`name`/`favoriteCount`/`reviewCount`; default `createdAt`) and
`sortOrder` (`asc` | `desc`; default `asc`) — either being present but invalid returns 400.
`buildOrderBy` in `market.service.ts` sorts `favoriteCount`/`reviewCount` via Prisma's relation
`_count` ordering (`orderBy: { favorites: { _count: sortOrder } }`) rather than a raw query, and
always appends `{ id: "asc" }` as a tiebreaker so pagination stays deterministic when many items
share the same sort-field value (e.g. the same price). `averageRating` is intentionally NOT
sortable — Prisma has no built-in way to order by a relation's average, and doing it correctly
would need a raw/grouped query outside this pattern; if that's ever needed, it's a separate query
shape; don't bolt it onto `buildOrderBy`.

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

## Reviews & ratings

A `Review` row (`userId` + `marketItemId`, unique together — one review per user per item, both
`onDelete: Cascade`) backs ratings/comments (`src/services/review.service.ts`,
`src/controllers/review.controller.ts`):

- `POST /api/market/items/:id/reviews` — create (auth required); body `{ rating: 1-5 integer,
  comment?: string }`. 201 on success, 400 on an invalid/missing rating or non-string comment, 404
  if the item doesn't exist, 409 if this user already reviewed the item (use `PATCH` to edit
  instead — unlike favorites, a duplicate review is a real conflict, not idempotent).
- `PATCH /api/market/items/:id/reviews/:reviewId` — edit own review (auth required); 403 if you're
  not the review's author, 404 if it doesn't exist.
- `DELETE /api/market/items/:id/reviews/:reviewId` — delete (auth required); allowed for the
  review's author OR an `ADMIN`, 403 otherwise, 404 if it doesn't exist.
- `GET /api/market/items/:id/reviews` — public, paginated (same `{ items, pagination }` shape).

## Product images

Images are stored on local disk under `uploads/market-items/` (gitignored; created at startup by
`ensureUploadDirs()` in `src/upload.ts`) and served statically at `/uploads/...`
(`app.use("/uploads", express.static(UPLOADS_ROOT))` in `src/app.ts`). This is fine for local
dev/single-instance deployments; a real multi-instance or ephemeral-filesystem deployment should
swap the storage backend (e.g. S3) — the `MarketItemImage.url` field is the seam to change.

- `POST /api/market/items/:id/images` — auth required; multipart form, field name `images` (up to
  5 files per request, JPEG/PNG/WEBP/GIF only, 5MB max each — see `src/upload.ts`). 201 with
  `{ images: [...] }` on success, 400 for no files/wrong type/too large/too many (translated from
  multer's error via `handleImageUpload` in `src/middleware/upload.middleware.ts`, so it's a JSON
  400 rather than a raw 500), 404 if the item doesn't exist (any files multer already wrote to
  disk before the item-existence check are cleaned up in that case —
  `src/services/image.service.ts`).
- `DELETE /api/market/items/:id/images/:imageId` — auth required; 204 and deletes both the DB row
  and the file on disk, 404 if the image doesn't exist (or belongs to a different item).
- Every market item response's `images` array (ordered oldest-first) comes from the same
  `ITEM_COUNTS_INCLUDE` used for favorite/review counts (`src/services/market.service.ts`) — add
  new image-derived fields there, not as a separate query.
- `marketService.deleteItem` fetches each image's filename before the cascade delete removes the
  `MarketItemImage` rows, then unlinks those files from disk afterward — otherwise deleting an
  item would silently orphan its image files. Follow the same fetch-before/unlink-after pattern
  for any other endpoint that deletes a `MarketItem`.

## Categories

A flat (non-hierarchical) `Category` model (`name`, unique) backs product categorization
(`src/services/category.service.ts`, `src/controllers/category.controller.ts`, mounted at
`/api/categories`):

- `GET /api/categories` — public, paginated (same `{ items, pagination }` shape).
- `POST /api/categories` — admin-only; body `{ name }`. 201 on success, 400 on an empty/missing
  name, 409 if the name is already taken.
- `PATCH /api/categories/:id` — admin-only; body `{ name }`. 404 if not found, 409 on a name
  collision.
- `DELETE /api/categories/:id` — admin-only; 204, 404 if not found. `MarketItem.category` uses
  `onDelete: SetNull`, so deleting a category un-sets it from every item that had it (their
  `categoryId` becomes `null`) rather than deleting those items or blocking the delete.

Market items reference a category optionally:

- `MarketItem.categoryId` is nullable; `POST`/`PATCH /api/market/items` accept an optional
  `categoryId` in the body (`PATCH` also accepts `categoryId: null` to clear it).
  `marketService.createItem`/`updateItem` don't pre-check the id — they let Postgres's foreign-key
  constraint reject an unknown one and catch Prisma's `P2003` error code, throwing
  `InvalidCategoryError` (→ 400 `"categoryId does not refer to an existing category"` in
  `market.controller.ts`). Follow this catch-the-FK-violation pattern rather than adding a
  separate existence-check query before every write.
- `GET /api/market/items?categoryId=...` filters by exact match; an id for a category that
  doesn't exist (or no longer does) just yields no results, not an error — so it doesn't need the
  same P2003-style handling as the write paths.
- Every market item response includes `category: { id, name, createdAt, updatedAt } | null` via
  the same `ITEM_COUNTS_INCLUDE` used for favorites/reviews/images (`src/services/market.service.ts`)
  — add it there, not as a separate query, same as the other relations on this include.

## Aggregates on market item responses

Every market item response (list, detail, create, update, and the favorites list) includes
`favoriteCount`, `reviewCount`, and `averageRating` (rounded to 1 decimal, `null` if there are no
reviews yet) via `MarketItemWithAggregates` (`src/types/market.types.ts`). In
`src/services/market.service.ts`, `withAggregates` shapes a Prisma
`include: { _count: { select: { favorites: true, reviews: true } } }` result (giving
`favoriteCount`/`reviewCount` in the same query, no N+1) plus a separately-fetched rating map from
`getAverageRatings` (`src/services/rating.util.ts`, a `prisma.review.groupBy` — one extra query
regardless of how many items are in the result set, never per-item). `favorite.service.ts`'s
`listUserFavorites` follows the same pattern. Reuse `getAverageRatings`/`withAggregates` rather
than recomputing counts or averages separately if you add another endpoint that returns market
items.

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
- `src/upload.ts` — multer config (`uploadMarketItemImages`) and upload-directory constants/setup
  (`ensureUploadDirs`, `UPLOADS_ROOT`, `MARKET_ITEM_IMAGES_DIR`); see Product images below.
- `src/routes/market.routes.ts`, `src/routes/auth.routes.ts`, `src/routes/favorites.routes.ts`,
  `src/routes/users.routes.ts`, `src/routes/categories.routes.ts` — map HTTP verbs/paths to
  controller functions, wrapped in `asyncHandler` (`src/utils/asyncHandler.ts`) so rejected
  promises reach the error-handling middleware instead of crashing silently. The item-scoped
  favorite/review/image routes (`/:id/favorite`, `/:id/reviews`, `/:id/images`) live in
  `market.routes.ts`; the "my favorites" list route lives in `favorites.routes.ts` (mounted at
  `/api/market/favorites`); admin user management lives in `users.routes.ts` (mounted at
  `/api/users`); categories live in `categories.routes.ts` (mounted at `/api/categories`) — all
  in `src/app.ts`.
- `src/middleware/auth.middleware.ts` — `authenticate`/`authorize` (see Authentication section
  above). `src/middleware/upload.middleware.ts` — `handleImageUpload` wraps the multer middleware
  so its errors become JSON 400s instead of uncaught exceptions.
- `src/utils/pagination.ts` — `parsePagination(query)` parses/validates `page`/`limit` (default
  20, capped at 100); reused by every paginated list controller rather than reimplemented per
  controller.
- `src/controllers/market.controller.ts`, `src/controllers/auth.controller.ts`,
  `src/controllers/favorite.controller.ts`, `src/controllers/review.controller.ts`,
  `src/controllers/user.controller.ts`, `src/controllers/image.controller.ts`,
  `src/controllers/category.controller.ts` — parse/validate request data, call the service layer,
  shape HTTP responses/status codes.
- `src/services/market.service.ts`, `src/services/auth.service.ts`,
  `src/services/favorite.service.ts`, `src/services/review.service.ts`,
  `src/services/user.service.ts`, `src/services/image.service.ts`, `src/services/category.service.ts`,
  `src/services/rating.util.ts` — business logic and data access, backed by Prisma
  (`prisma.marketItem`, `prisma.user`, `prisma.favorite`, `prisma.review`, `prisma.marketItemImage`,
  `prisma.category`). This is the layer to touch if the persistence approach changes; the
  controller/route layers don't need to know it's Postgres (or, for images, local disk).
- `src/types/market.types.ts`, `src/types/auth.types.ts`, `src/types/review.types.ts`,
  `src/types/category.types.ts` — shared TypeScript types, re-exporting Prisma-generated types
  (`MarketItem`, `MarketItemImage`, `Role`, `Review`, `Category`) alongside request input shapes.
- `prisma/schema.prisma` — the
  `MarketItem`/`User`/`Role`/`Favorite`/`Review`/`MarketItemImage`/`Category` models and
  datasource config; `prisma/migrations/` holds the generated SQL migrations (commit these
  alongside schema changes).

Tests (`tests/market.test.ts`, `tests/auth.test.ts`, `tests/favorites.test.ts`,
`tests/reviews.test.ts`, `tests/users.test.ts`, `tests/images.test.ts`, `tests/categories.test.ts`)
use `supertest` against the app built by `createApp()` and hit the real database configured by
`DATABASE_URL` — they don't start a real network listener, but they are integration tests, not
pure unit tests.
