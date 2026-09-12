# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- Install dependencies: `npm install`
- Build (TypeScript -> `dist/`): `npm run build`
- Run in dev mode (auto-restart): `npm run dev`
- Start built server: `npm start`
- Lint: `npm run lint`
- Run all tests: `npm test`
- Run a single test file: `npx jest tests/market.test.ts`
- Run a single test by name: `npx jest -t "creates, fetches, updates, and deletes an item"`

## Architecture

Node.js/TypeScript/Express backend API for the "market" feature. Layout follows a standard
route -> controller -> service pattern:

- `src/app.ts` — builds the Express app (middleware, route mounting). Exported separately from
  `src/index.ts` so tests can import the app without binding a port.
- `src/index.ts` — process entry point; starts the HTTP server (`PORT` env var, default 3000).
- `src/routes/market.routes.ts` — maps HTTP verbs/paths under `/api/market/items` to controller
  functions.
- `src/controllers/market.controller.ts` — parses/validates request data, calls the service layer,
  shapes HTTP responses/status codes.
- `src/services/market.service.ts` — business logic and data access. Currently backed by an
  in-memory `Map` (no database yet) — replace this layer with real persistence when one is added,
  keeping the controller/route layers unchanged.
- `src/types/market.types.ts` — shared TypeScript types for the market domain
  (`MarketItem`, create/update input shapes).

Tests (`tests/market.test.ts`) use `supertest` against the app built by `createApp()` — they don't
start a real network listener.
