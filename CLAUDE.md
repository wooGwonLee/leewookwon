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
  `tests/users.test.ts`, `tests/images.test.ts`, `tests/categories.test.ts`, `tests/stock.test.ts`,
  `tests/orders.test.ts`, `tests/options.test.ts`, `tests/adminStats.test.ts`,
  `tests/addresses.test.ts`) share one real database — and, for images, the same `uploads/`
  directory on disk — and would otherwise race each other; every test file whose
  `beforeEach` wipes `marketItem` must also wipe `order` first, since `OrderItem.marketItem` is
  `onDelete: Restrict` — see Orders below. `MarketItemOption` doesn't need its own explicit
  cleanup — it cascade-deletes with its parent `marketItem`)
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
(inclusive price range; a negative, non-numeric, or inverted min/max returns 400), `categoryId`
(exact match; an unknown/nonexistent id just yields an empty page, not an error — see Categories
below for why filtering doesn't validate the id), and `inStock` (`inStock=true` restricts to
`stock > 0`; any other value, including omitted, applies no stock filter — see Stock / inventory
below).
`marketService.listItems(page, limit, filters, sort)` (`src/services/market.service.ts`) builds a
`Prisma.MarketItemWhereInput` from the filters, runs `findMany`/`count` in parallel, and returns
`PaginatedResult<T>` (`src/types/market.types.ts`) — follow the same pattern for other list
endpoints added later. `MarketItemFilters` also has a `maxStock` field (`stock <= maxStock`) that
`buildWhere` combines with `inStock` into a single `stock` condition — it's deliberately NOT wired
up to `market.controller.ts`'s public query parsing, only called directly by
`stats.controller.ts`'s low-stock endpoint (see Admin statistics below); add public query parsing
for it too if a public "low stock" filter is ever wanted.

Sorting: `sortBy` (one of `SORTABLE_FIELDS` in `src/types/market.types.ts` —
`createdAt`/`price`/`viewCount`/`name`/`favoriteCount`/`reviewCount`/`stock`; default `createdAt`) and
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

## Stock / inventory

`MarketItem.stock` (`Int`, default 0, never negative) tracks how many units of an item are
available (`src/services/market.service.ts`, `src/controllers/market.controller.ts`):

- `POST`/`PATCH /api/market/items` accept an optional `stock` in the body (create defaults to 0
  when omitted; update leaves it unchanged when omitted) — validated as a non-negative integer
  (`isNonNegativeInteger` in `market.controller.ts`), 400 otherwise. This is a direct set, meant
  for correcting/initializing stock, not for recording a sale/restock — use the endpoint below for
  that.
- `PATCH /api/market/items/:id/stock` — auth required; body `{ delta: <non-zero integer> }`
  (positive to restock, negative to record a sale/reservation). 400 if `delta` is zero, fractional,
  or not a number. 404 if the item doesn't exist. 409 (`InsufficientStockError`) if applying `delta`
  would take `stock` below 0 — the stock is left unchanged in that case. 200 with the updated item
  on success.
- `marketService.adjustStock` applies the delta via a single conditional
  `prisma.marketItem.updateMany({ where: delta < 0 ? { id, stock: { gte: -delta } } : { id }, data:
  { stock: { increment: delta } } } })` rather than a read-then-write — the `WHERE` clause itself
  gates the update on the resulting stock staying non-negative, so concurrent decrements can't race
  each other into a negative count (verified under concurrent load: 15 simultaneous `-1` deltas
  against `stock=10` yielded exactly 10 successes and 5 `409`s, landing at `stock=0`, never
  negative). If `updateMany`'s `count` is 0, a follow-up `findUnique` distinguishes "item doesn't
  exist" (404) from "item exists but the delta was rejected" (409) — don't replace this with a plain
  `update()` plus a manual negative check, since that reintroduces the race.
- `GET /api/market/items?inStock=true` filters to `stock > 0` (see Pagination section above);
  `stock` is also a valid `sortBy` value.
- Follow this same conditional-`updateMany` pattern for any future "adjust a counter but never let
  it go negative/over a cap" field, rather than a naive read-modify-write.

## Orders

An `Order` (`userId`, `status`, `totalPrice`) with one or more `OrderItem` rows (`marketItemId`,
`quantity`, `priceAtOrder` — a snapshot of the item's price at order time, since the item's live
price can change later) backs a minimal cart-checkout flow with no payment integration
(`src/services/order.service.ts`, `src/controllers/order.controller.ts`, mounted at `/api/orders`).
`Order.userId` is `onDelete: Cascade` (deleting a user drops their orders); `OrderItem.marketItemId`
is `onDelete: Restrict` (deliberately — an item that has ever been ordered can't be deleted, so
order history never dangles; see the `marketService.deleteItem` note below).

- `POST /api/orders` — auth required; body `{ items: [{ marketItemId, marketItemOptionId?,
  quantity: positive integer }, ...], addressId? }` (`items` non-empty, no duplicate
  `marketItemId`+`marketItemOptionId` pair within one request — merge quantities client-side
  instead; ordering the same item with two *different* options in one request is fine). 400 on a
  malformed body (including a present-but-non-string/empty `addressId`). 404 if any referenced item
  or option doesn't exist (or the option doesn't belong to the given `marketItemId` — see Product
  options below), or if `addressId` doesn't refer to an address owned by the requesting user (see
  Shipping addresses below — a real address owned by someone else 404s exactly like a
  nonexistent one, not 403, since it's equally unusable to this order). 409
  (`InsufficientStockError`, reused from `marketService`) if any line item's `quantity` exceeds the
  current stock — the item's `stock` if no `marketItemOptionId` is given, the option's own `stock`
  otherwise (see Product options below). 201 with the created order (`status: "PENDING"`) on
  success. `orderService.createOrder` runs the whole thing in one `prisma.$transaction`: for each
  line item it decrements stock (item- or option-level) via the same conditional-`updateMany`
  pattern as `marketService.adjustStock` (`WHERE stock >= quantity`, race-safe under concurrent
  orders for the same item/option), and accumulates `totalPrice` from each item's live price (plus
  the option's `priceDelta`, if any) at the moment of purchase. If `addressId` is given, the
  matching address's fields are copied into `Order.shippingSnapshot` (a `Json` column) at creation
  time — see Shipping addresses below for why this is snapshotted rather than just referenced. If
  any single line item fails (missing item/option, insufficient stock) or the address doesn't
  resolve, the whole transaction rolls back — no order is created and no stock already decremented
  for earlier items in the same request is left decremented. Follow this same
  "loop-and-accumulate inside one `$transaction`" shape for any future multi-row, all-or-nothing
  write.
- `GET /api/orders` — auth required, paginated (same `{ items, pagination }` shape). A regular
  user sees only their own orders; an `ADMIN` sees every order (role-based scoping happens in
  `order.controller.ts`'s `list`, not a separate endpoint — there's no "my orders" vs "all orders"
  route split).
- `GET /api/orders/:id` — auth required; the order's owner or an `ADMIN` can view it, 403
  otherwise, 404 if it doesn't exist.
- `PATCH /api/orders/:id/cancel` — auth required; the order's owner or an `ADMIN` can cancel it,
  403 otherwise, 404 if missing, 409 unless the order is still `PENDING` (self-serve cancellation
  is only for orders nobody has acted on yet — once `CONFIRMED`, only the admin status endpoint
  below can move it). Restores the stock that was reserved at order creation.
- `PATCH /api/orders/:id/status` — admin-only (`authorize("ADMIN")`); body `{ status }`, one of
  `PENDING`/`CONFIRMED`/`COMPLETED`/`CANCELLED`. 400 if `status` isn't one of those. 404 if the
  order doesn't exist. 409 if the transition isn't allowed — `ALLOWED_TRANSITIONS` in
  `order.service.ts` only permits `PENDING → CONFIRMED | CANCELLED` and
  `CONFIRMED → COMPLETED | CANCELLED`; `COMPLETED` and `CANCELLED` are terminal (no further
  transitions). Transitioning to `CANCELLED` from either allowed state restores stock, same as the
  cancel endpoint above (both funnel through the same `restoreStockForOrder` helper).
- Every order response includes `items`, each with a nested `marketItem: { id, name }` and
  `marketItemOption: { id, name } | null` (via `ORDER_INCLUDE` in `order.service.ts`, one query, no
  N+1) so a client doesn't have to re-fetch item/option names separately.
- Because `OrderItem.marketItemId` is `onDelete: Restrict`, `marketService.deleteItem` now also
  catches Prisma's `P2003` (in addition to the existing `P2025`-for-not-found handling) and throws
  `ItemHasOrdersError` → 409 `"Cannot delete an item that has existing orders"` in
  `market.controller.ts`'s `remove` — deleting an item that was never ordered is unaffected. This
  also transitively protects any of the item's options that have order history, since
  `OrderItem.marketItemId` is always set (whether or not a `marketItemOptionId` was also given) —
  see Product options below for the option-level equivalent (`OptionHasOrdersError`).

## Product options (variants)

A `MarketItemOption` (`marketItemId`, `name`, `priceDelta`, `stock`) represents one purchasable
variant of an item — e.g. a specific size/color combination — with its own inventory and an
optional price adjustment relative to the base item (`src/services/option.service.ts`,
`src/controllers/option.controller.ts`, sub-routes of `market.routes.ts`). `name` is unique per
item (`@@unique([marketItemId, name])`) so you can't create two options with the same label on one
item (e.g. two `"L / Red"` options); it's a free-text label, not structured attributes — pick a
convention like `"L / Red"` client-side. `MarketItemOption.marketItemId` is `onDelete: Cascade`
(deleting an item deletes its options, same as images) but `OrderItem.marketItemOptionId` is
`onDelete: Restrict`, same rationale as the item-level FK in Orders above.

- `POST /api/market/items/:id/options` — auth required; body `{ name, priceDelta?, stock? }`.
  `priceDelta` defaults to `0` (same price as the base item; can be negative for a discount
  variant), `stock` defaults to `0`. 400 on an empty/missing `name`, non-number `priceDelta`, or a
  negative/fractional `stock`. 404 if the item doesn't exist. 409 if the name is already taken on
  this item. 201 with the created option on success.
- `PATCH /api/market/items/:id/options/:optionId` — auth required; same field validation as create,
  all fields optional. 404 if the option doesn't exist *or* belongs to a different item (checked
  explicitly in `option.service.ts`, not just a raw `findUnique` on `optionId` alone — an option id
  that's real but under the wrong item path 404s rather than silently succeeding). 409 on a name
  collision.
- `DELETE /api/market/items/:id/options/:optionId` — auth required; 204, 404 same as above, 409
  (`OptionHasOrdersError`, from catching `P2003`) if the option has ever been ordered — mirrors
  `ItemHasOrdersError` in `marketService.deleteItem`.
- There's no separate `GET` list endpoint for options — every market item response embeds its
  `options` array (ordered oldest-first, via `ITEM_COUNTS_INCLUDE` in `market.service.ts`, same as
  `images`) rather than requiring a second request.
- Ordering a specific variant: `POST /api/orders`'s line items take an optional
  `marketItemOptionId` alongside `marketItemId` — see Orders above for the full behavior
  (option-level stock decrement, `priceAtOrder = item.price + option.priceDelta`, option-level
  stock restore on cancel). Omitting `marketItemOptionId` orders the base item exactly as before
  options existed — this feature is purely additive, not a breaking change to the order flow for
  items without variants.

## Shipping addresses

An `Address` (`userId`, `label?`, `recipientName`, `phone`, `postalCode`, `address1`, `address2?`,
`isDefault`) lets a user save multiple shipping addresses and pick one at order time
(`src/services/address.service.ts`, `src/controllers/address.controller.ts`, mounted at
`/api/addresses`). `Address.userId` is `onDelete: Cascade` (deleting a user drops their saved
addresses); addresses are strictly owner-only — unlike orders, there's no `ADMIN` override on read
(`get`/`update`/`delete` all just 403 a non-owner, even an admin), since a saved address is PII the
owner hasn't chosen to share, not something staff need to manage.

- `POST /api/addresses` — auth required; body `{ label?, recipientName, phone, postalCode,
  address1, address2?, isDefault? }`. `recipientName`/`phone`/`postalCode`/`address1` are required
  non-empty strings; `label`/`address2` are optional strings; `isDefault` is an optional boolean
  (default `false`). 400 on any violation. 201 on success.
- `GET /api/addresses` — auth required, paginated (same `{ items, pagination }` shape); only the
  current user's own addresses, ordered default-first then newest-first
  (`orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }]`).
- `GET /api/addresses/:id` / `PATCH /api/addresses/:id` / `DELETE /api/addresses/:id` — auth
  required; 404 if the address doesn't exist, 403 if it exists but belongs to a different user.
  `PATCH` accepts any subset of the create fields (`label`/`address2` may also be set to `null` to
  clear them). 204 on delete.
- At most one address per user has `isDefault: true`. Setting `isDefault: true` on create or
  update runs in a `prisma.$transaction` that first clears the flag on any other address owned by
  that user (`unsetOtherDefaults` in `address.service.ts`), then writes the new one — there's no
  unique index enforcing this (a partial unique index on `(userId) WHERE isDefault` would need a
  raw migration Prisma's schema syntax doesn't express directly), so the transaction *is* the
  invariant; don't add a second default-setting code path that skips it. There's no auto-promoting
  a replacement default when the current default is deleted — deleting it just leaves the user
  with no default until they set one explicitly.
- Selecting an address at order time: `POST /api/orders` takes an optional top-level `addressId`
  (a sibling of `items`, not per-line-item). If given, `orderService.createOrder` copies the
  address's fields into `Order.shippingSnapshot` (a `Json` column) and records `Order.
  shippingAddressId` — but `shippingAddressId` is `onDelete: SetNull` (deliberately different from
  the `Restrict` used for `OrderItem.marketItemId`/`marketItemOptionId`): an address is just saved
  metadata, not inventory, so a user must be able to freely delete an old address even if it was
  used on a past order, and the snapshot already preserves that order's shipping details regardless
  of whether the address still exists — `marketService.deleteItem`'s P2003-catching pattern does
  NOT apply here, `address.service.ts`'s `deleteAddress` never needs to catch a delete-blocked
  error. Omitting `addressId` leaves both `shippingAddressId` and `shippingSnapshot` `null` — this
  feature is purely additive, not a breaking change to the order flow for orders that don't need
  shipping.

## Admin statistics

Read-only reporting endpoints for admins (`src/services/stats.service.ts`,
`src/controllers/stats.controller.ts`, mounted at `/api/admin`, all three routes
`authenticate` + `authorize("ADMIN")` — 401 unauthenticated, 403 non-admin):

- `GET /api/admin/stats/summary` — `{ totalUsers, totalItems, totalOrders, ordersByStatus: {
  PENDING, CONFIRMED, COMPLETED, CANCELLED }, totalRevenue, lowStockThreshold, lowStockItemCount
  }`. Optional `lowStockThreshold` query param (default `5`, must be a non-negative integer, 400
  otherwise) — an item counts as low-stock when `stock <= lowStockThreshold`. `totalRevenue` sums
  `totalPrice` only across `COMPLETED` orders — deliberately not `PENDING`/`CONFIRMED` (not yet
  realized sales) and not `CANCELLED` (never realized). `ordersByStatus` always includes all four
  status keys (even `0`) rather than omitting statuses with no orders, so clients don't need to
  default missing keys themselves.
- `GET /api/admin/stats/top-items` — array of `{ marketItemId, name, totalQuantitySold,
  totalRevenue }`, sorted by `totalQuantitySold` descending. Optional `limit` query param (default
  `10`, must be a positive integer, 400 otherwise; capped at `MAX_LIMIT` from
  `src/utils/pagination.ts`, same cap as regular pagination). Counts every `OrderItem` whose order
  is NOT `CANCELLED` (so `PENDING`/`CONFIRMED`/`COMPLETED` all count as "sold", matching how stock
  is already reserved for them) — `stats.service.ts`'s `getTopSellingItems` fetches the matching
  `OrderItem` rows and aggregates `quantity`/`quantity * priceAtOrder` in memory per
  `marketItemId`, rather than a Prisma `groupBy` `_sum`, because a `groupBy` sum of `priceAtOrder`
  would add up per-unit prices instead of computing `quantity * priceAtOrder` per row — do the
  same in-memory aggregation if you extend this, not a raw `groupBy` sum, or per-item revenue will
  be wrong whenever any row has `quantity > 1`.
- `GET /api/admin/stats/low-stock` — paginated (same `{ items, pagination }` shape as other list
  endpoints), items with `stock <= threshold` (query param, default `5`, non-negative integer, 400
  otherwise) sorted by `stock` ascending. Implemented by calling `marketService.listItems` with the
  `maxStock` filter and an explicit `{ sortBy: "stock", sortOrder: "asc" }` sort — reuses the
  existing list/pagination/aggregates machinery rather than a parallel query, so responses have the
  same shape (favorites/reviews/images/options/category included) as every other item list.

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
  `src/routes/users.routes.ts`, `src/routes/categories.routes.ts`, `src/routes/orders.routes.ts`,
  `src/routes/admin.routes.ts`, `src/routes/addresses.routes.ts` — map HTTP verbs/paths to
  controller functions, wrapped in `asyncHandler` (`src/utils/asyncHandler.ts`) so rejected
  promises reach the error-handling middleware instead of crashing silently. The item-scoped
  favorite/review/image/option routes (`/:id/favorite`, `/:id/reviews`, `/:id/images`,
  `/:id/options`) live in `market.routes.ts`; the "my favorites" list route lives in
  `favorites.routes.ts` (mounted at `/api/market/favorites`); admin user management lives in
  `users.routes.ts` (mounted at `/api/users`); categories live in `categories.routes.ts` (mounted
  at `/api/categories`); orders live in `orders.routes.ts` (mounted at `/api/orders`); admin stats
  live in `admin.routes.ts` (mounted at `/api/admin`); saved shipping addresses live in
  `addresses.routes.ts` (mounted at `/api/addresses`) — all in `src/app.ts`.
- `src/middleware/auth.middleware.ts` — `authenticate`/`authorize` (see Authentication section
  above). `src/middleware/upload.middleware.ts` — `handleImageUpload` wraps the multer middleware
  so its errors become JSON 400s instead of uncaught exceptions.
- `src/utils/pagination.ts` — `parsePagination(query)` parses/validates `page`/`limit` (default
  20, capped at 100); reused by every paginated list controller rather than reimplemented per
  controller.
- `src/controllers/market.controller.ts`, `src/controllers/auth.controller.ts`,
  `src/controllers/favorite.controller.ts`, `src/controllers/review.controller.ts`,
  `src/controllers/user.controller.ts`, `src/controllers/image.controller.ts`,
  `src/controllers/category.controller.ts`, `src/controllers/order.controller.ts`,
  `src/controllers/option.controller.ts`, `src/controllers/stats.controller.ts`,
  `src/controllers/address.controller.ts` — parse/validate request data, call the service layer,
  shape HTTP responses/status codes.
- `src/services/market.service.ts`, `src/services/auth.service.ts`,
  `src/services/favorite.service.ts`, `src/services/review.service.ts`,
  `src/services/user.service.ts`, `src/services/image.service.ts`, `src/services/category.service.ts`,
  `src/services/order.service.ts`, `src/services/option.service.ts`, `src/services/stats.service.ts`,
  `src/services/address.service.ts`, `src/services/rating.util.ts` — business logic and data
  access, backed by Prisma (`prisma.marketItem`, `prisma.user`, `prisma.favorite`, `prisma.review`,
  `prisma.marketItemImage`, `prisma.category`, `prisma.order`, `prisma.orderItem`,
  `prisma.marketItemOption`, `prisma.address`). This is the layer to touch if the persistence
  approach changes; the controller/route layers don't need to know it's Postgres (or, for images,
  local disk). `stats.service.ts` reads across several tables but writes nothing of its own — no
  new Prisma model backs it.
- `src/types/market.types.ts`, `src/types/auth.types.ts`, `src/types/review.types.ts`,
  `src/types/category.types.ts`, `src/types/order.types.ts`, `src/types/option.types.ts`,
  `src/types/stats.types.ts`, `src/types/address.types.ts` — shared TypeScript types, re-exporting
  Prisma-generated types (`MarketItem`, `MarketItemImage`, `Role`, `Review`, `Category`, `Order`,
  `OrderItem`, `OrderStatus`, `MarketItemOption`, `Address`) alongside request input shapes;
  `stats.types.ts` is response-shape types only (`StatsSummary`, `TopSellingItem`), since admin
  stats have no request input beyond query params. `address.types.ts` also defines
  `ShippingSnapshot`, the shape stored in `Order.shippingSnapshot` — shared between
  `address.service.ts` (source fields) and `order.service.ts` (where it's built and persisted).
- `prisma/schema.prisma` — the
  `MarketItem`/`User`/`Role`/`Favorite`/`Review`/`MarketItemImage`/`Category`/`Order`/`OrderItem`/`OrderStatus`/`MarketItemOption`/`Address`
  models and datasource config; `prisma/migrations/` holds the generated SQL migrations (commit
  these alongside schema changes).

Tests (`tests/market.test.ts`, `tests/auth.test.ts`, `tests/favorites.test.ts`,
`tests/reviews.test.ts`, `tests/users.test.ts`, `tests/images.test.ts`, `tests/categories.test.ts`,
`tests/stock.test.ts`, `tests/orders.test.ts`, `tests/options.test.ts`,
`tests/adminStats.test.ts`, `tests/addresses.test.ts`) use `supertest` against the app built by
`createApp()` and hit the real database configured by `DATABASE_URL` — they don't start a real
network listener, but they are integration tests, not pure unit tests.
