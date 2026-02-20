# Dependency Upgrade Log

**Date:** 2026-02-19  |  **Project:** flywheel_gateway  |  **Runtime:** Bun/TypeScript

## Summary

- **Updated:** 30  |  **Skipped:** 1  |  **Failed:** 0  |  **Needs attention:** 0

## Note on Rust Toolchain

This project has no Rust code (no `Cargo.toml` or `rust-toolchain.toml`). The Rust nightly toolchain request does not apply here.

## Major Version Bumps

### framer-motion: ^11.0.0 -> ^12.34.2

- **Breaking:** `Transition.ease` type narrowed; spring configs no longer accepted as `Easing` values
- **Migration:** Restricted `createTransition()` ease parameter to `"out" | "inOut"` (bezier curves only)
- **Tests:** Passed

### zustand: ^4.5.6 -> ^5.0.11

- **Breaking:** TypeScript generic changes, removed deprecated APIs
- **Migration:** None needed — project uses basic `create<State>((set, get) => ({...}))` pattern which is unchanged
- **Tests:** Passed

## Significant Pre-1.0 Bumps

### drizzle-orm: ^0.40.1 -> ^0.45.1

- **Breaking:** None encountered for SQLite/bun:sqlite usage
- **Tests:** Passed (42 files use drizzle-orm)

### lucide-react: ^0.468.0 -> ^0.575.0

- **Breaking:** None — all icon names used in codebase still exist
- **Tests:** Passed

### @modelcontextprotocol/sdk: ^1.12.0 -> ^1.26.0

- **Breaking:** None encountered
- **Tests:** Passed

### @opentelemetry/exporter-trace-otlp-http: ^0.211.0 -> ^0.212.0

- **Breaking:** None
- **Tests:** Passed

### @opentelemetry/exporter-trace-otlp-proto: ^0.211.0 -> ^0.212.0

- **Breaking:** None
- **Tests:** Passed

## Minor/Patch Updates

| Package | From | To | Location |
|---------|------|----|----------|
| @biomejs/biome | ^2.3.11 | ^2.4.3 | root |
| @playwright/test | ^1.57.0 | ^1.58.2 | root, web |
| @types/bun | ^1.3.6 | ^1.3.9 | root |
| zod | ^4.3.5 | ^4.3.6 | root, shared, flywheel-clients |
| @opentelemetry/resources | ^2.5.0 | ^2.5.1 | gateway |
| @opentelemetry/sdk-trace-base | ^2.5.0 | ^2.5.1 | gateway |
| hono | ^4.11.0 | ^4.12.0 | gateway |
| pino | ^10.1.1 | ^10.3.1 | gateway |
| yaml | ^2.8.0 | ^2.8.2 | gateway |
| better-sqlite3 | ^12.5.0 | ^12.6.2 | gateway |
| drizzle-kit | ^0.31.8 | ^0.31.9 | gateway |
| @tanstack/react-query | ^5.90.0 | ^5.90.21 | web |
| @tanstack/react-router | ^1.145.0 | ^1.161.1 | web |
| react | ^19.2.0 | ^19.2.4 | web |
| react-dom | ^19.2.0 | ^19.2.4 | web |
| @tailwindcss/vite | ^4.0.0 | ^4.2.0 | web |
| tailwindcss | ^4.0.0 | ^4.2.0 | web |
| @types/react | ^19.0.10 | ^19.2.14 | web |
| @types/react-dom | ^19.0.4 | ^19.2.3 | web |
| @vitejs/plugin-react | ^5.1.2 | ^5.1.4 | web |
| vite | ^7.3.0 | ^7.3.1 | web |

## Skipped

### typescript: ^5.9.3

- **Reason:** Already at latest stable. TypeScript 6.0 is beta-only (released Feb 11 2026).

## Additional Fixes

### biome.json schema version

- Updated `$schema` URL from `2.3.11` to `2.4.3` to match installed Biome version.

### dcg-stats.service.ts formatting

- Auto-formatted via `bun format` to fix whitespace differences detected by Biome 2.4.3.

### animations.ts type fix

- Narrowed `createTransition()` ease parameter from `keyof typeof EASE` to `"out" | "inOut"` to satisfy framer-motion v12's stricter `Easing` type.

## Quality Gates

- **TypeScript:** Clean (0 errors)
- **Biome lint:** Clean (0 errors, 5 pre-existing warnings)
- **Tests:** 3728 pass, 35 skip, 1 pre-existing fail (beads env issue, unrelated)
