# Market API

A Node.js/TypeScript/Express REST API for a marketplace ("market") feature, backed by PostgreSQL
via Prisma. It covers product listings, JWT authentication with role-based authorization,
favorites, reviews, images, categories, stock/inventory, orders/checkout, product options
(variants), shipping addresses, and admin reporting.

## Tech stack

- **Runtime**: Node.js (>= 18), TypeScript, Express
- **Database**: PostgreSQL via [Prisma](https://www.prisma.io/)
- **Auth**: JWT bearer tokens (`jsonwebtoken`), passwords hashed with `bcryptjs`
- **File uploads**: `multer` (product images, stored on local disk)
- **Testing**: Jest + Supertest (integration tests against a real Postgres database)

## Getting started

### Prerequisites

- Node.js >= 18
- A running PostgreSQL instance

### Setup

```bash
npm install                # also runs `prisma generate` via postinstall
cp .env.example .env       # then edit DATABASE_URL / JWT_SECRET as needed
npm run prisma:migrate     # creates the schema in your database
```

`.env` variables:

| Variable          | Description                                      | Example                                                          |
| ------------------ | ------------------------------------------------- | ------------------------------------------------------------------ |
| `DATABASE_URL`     | Postgres connection string                        | `postgresql://postgres:postgres@localhost:5432/market_dev?schema=public` |
| `PORT`             | HTTP port (default `3000`)                         | `3000`                                                            |
| `JWT_SECRET`       | Secret used to sign auth tokens (long random string) | `change-me-to-a-long-random-string`                               |
| `JWT_EXPIRES_IN`   | Token lifetime                                     | `1h`                                                               |

### Running

```bash
npm run dev     # dev server, auto-restarts on change
npm run build   # compile TypeScript -> dist/
npm start       # run the compiled server (after npm run build)
```

### Testing

Tests are integration tests that hit a real Postgres database — point `DATABASE_URL` at a
disposable/test database (not one with real data), then:

```bash
npm run prisma:migrate:deploy   # apply migrations without prompting
npm test                        # runs all test suites (--runInBand; they share one database)
```

Run a single file or test:

```bash
npx jest tests/market.test.ts
npx jest -t "creates, fetches, updates as a regular user, and deletes as an admin"
```

### Linting

```bash
npm run lint
```

CI (`.github/workflows/ci.yml`) runs lint, build, migrations, and the full test suite against a
`postgres:16` service container on every push to `main`/`claude/**` and every pull request.

## API overview

All endpoints are prefixed as shown. Endpoints marked **auth** require an
`Authorization: Bearer <token>` header (from `POST /api/auth/login`); **admin** additionally
requires the `ADMIN` role.

| Area | Endpoints |
| --- | --- |
| Auth | `POST /api/auth/register`, `POST /api/auth/login` |
| Users (admin) | `GET /api/users`, `PATCH /api/users/:id/role` |
| Market items | `GET /api/market/items`, `GET /api/market/items/:id`, `POST /api/market/items` **(auth)**, `PATCH /api/market/items/:id` **(auth)**, `DELETE /api/market/items/:id` **(admin)** |
| Stock | `PATCH /api/market/items/:id/stock` **(auth)** |
| Favorites | `POST`/`DELETE`/`GET /api/market/items/:id/favorite` **(auth)**, `GET /api/market/favorites` **(auth)** |
| Reviews | `GET /api/market/items/:id/reviews`, `POST /api/market/items/:id/reviews` **(auth)**, `PATCH`/`DELETE /api/market/items/:id/reviews/:reviewId` **(auth)** |
| Images | `POST /api/market/items/:id/images` **(auth)**, `DELETE /api/market/items/:id/images/:imageId` **(auth)** |
| Product options (variants) | `POST /api/market/items/:id/options` **(auth)**, `PATCH`/`DELETE /api/market/items/:id/options/:optionId` **(auth)** |
| Categories | `GET /api/categories`, `POST`/`PATCH`/`DELETE /api/categories[/:id]` **(admin)** |
| Orders | `POST /api/orders` **(auth)**, `GET /api/orders` **(auth)**, `GET /api/orders/:id` **(auth)**, `PATCH /api/orders/:id/cancel` **(auth)**, `PATCH /api/orders/:id/status` **(admin)** |
| Shipping addresses | `POST`/`GET /api/addresses` **(auth)**, `GET`/`PATCH`/`DELETE /api/addresses/:id` **(auth)** |
| Admin statistics | `GET /api/admin/stats/summary`, `GET /api/admin/stats/top-items`, `GET /api/admin/stats/low-stock` **(admin)** |
| Health check | `GET /health` |

Product images are additionally served statically at `/uploads/...`.

For full request/response details, status codes, validation rules, and the design rationale behind
each feature, see [`CLAUDE.md`](./CLAUDE.md).

## Project structure

```
src/
  app.ts                # Express app (middleware, route mounting)
  index.ts               # process entry point (starts the HTTP server)
  config.ts               # env var access
  db/prisma.ts             # shared PrismaClient instance
  upload.ts                # multer config, upload directory setup
  routes/                  # HTTP verb/path -> controller mapping
  controllers/              # request parsing/validation, response shaping
  services/                  # business logic and Prisma data access
  types/                      # shared TypeScript types
  middleware/                  # authenticate/authorize, upload error handling
  utils/                        # pagination helpers, asyncHandler
prisma/
  schema.prisma            # data model
  migrations/                # generated SQL migrations
tests/                        # Jest + Supertest integration tests
```

See [`CLAUDE.md`](./CLAUDE.md) for an in-depth architecture and feature-by-feature reference.
