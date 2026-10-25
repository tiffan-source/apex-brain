# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Apex Brain is the server of Apex (objectives → stages/sub-objectives → steps/tasks, an Eisenhower
"today focus", a per-objective conversation and the Akari AI assistant). It is an **Nx 23
monorepo** (TypeScript 6, ESM) with a **NestJS 12** app (`apps/api`) that exposes the domain
libraries over a REST API to the Apex web client (repo `tiffan-source/apex`, Angular) and the
mobile client (React Native). The libraries were ported from Apex (`libs/*`, `worklfows/ai-assistant`)
and keep their architecture. Code is in English; **docs, code comments, commit messages are in
French** — match that.

Read `docs/plan.md` (what was ported, fixed, what's left), `docs/architecture.md` (layers,
dependency rules, how to add a use case) and `docs/api.md` (HTTP contract) before larger changes.
Decisions live in `docs/adr/`.

## Commands

`package.json` has no scripts; everything runs through Nx (`npx nx …`).

| Task | Command |
|------|---------|
| Dev server (rebuild + restart on change) | `npx nx serve api` |
| Production build → `dist/apps/api/main.js` | `npx nx build api` |
| Unit/e2e tests (one project) | `npx nx vite:test <project>` |
| Everything | `npx nx run-many -t vite:test lint typecheck build` |
| Single test file | `npx nx vite:test api -- test/objectives.e2e.spec.ts` |
| Integration vs local Supabase | `npx nx run api:test-integration` and `SUPABASE_INTEGRATION=1 npx nx vite:test supabase` (env from `supabase status -o env`) |

- Projects: `api`, `chore`, `objective`, `auth`, `chat`, `ai`, `supabase`, `gemini`, `firebase`, `ai-assistant` (in `workflows/`, spelled correctly here).
- Test target is `vite:test` (Vitest 4). Build and tests both go through **Vite 8 / Oxc**, which emits decorator metadata (`emitDecoratorMetadata`), so `@nestjs/swagger` can read route params and bodies.
- Node 22.12+ or 24. `npm install` with npm 11 may skip install scripts: they're whitelisted in `package.json` `allowScripts`.
- Config: `apps/api/.env` (copy `.env.example`), validated at boot by `apps/api/src/config/environment.ts` (zod). `WORKFLOW_STATE_STORE=memory` avoids Firestore locally.

## Architecture

Clean/hexagonal, enforced by `@nx/enforce-module-boundaries` tags in `eslint.config.mjs`:
`type:kernel` (chore) ← `type:domain` (objective, auth, chat, ai — never import each other nor
any SDK/NestJS) ← `type:workflow` (ai-assistant) ← `type:infra` (supabase, gemini, firebase) ←
`type:app` (api).

- **Use cases** (`libs/*/src/lib/usecases/*.usecase.ts`) return `Promise<Result<T>>` via `runWithResult(action, [ExpectedError…], fallback)`; unlisted errors become `UNKNOWN_ERROR`. **Queries** (`*.query.ts`) are ports with no business logic; infra failures propagate (→ 500), "not found" is `null` (→ 404).
- **Ownership is explicit**: the server talks to Supabase with the secret key (RLS bypassed but still enabled in DB), so every port takes `ownerId` and every Supabase adapter filters on `user_id`; another person's row is "not found" (404). `SupabaseObjectiveRepository.save` refuses to upsert rows owned by someone else. See `docs/adr/0002-acces-aux-donnees.md`. Never add a data access path without the owner filter and an integration test of the isolation.
- **Auth** (`docs/adr/0003-authentification.md`): stateless `AuthProvider` port; Supabase Auth behind the API. A global `AuthGuard` verifies `Authorization: Bearer` via `GetCurrentUserUseCase` (`auth.getClaims`); `@Public()` opens a route; `@CurrentUser()` / `@AccessToken()` read the request. Sign-in/refresh use ephemeral Supabase clients (`createAuthClient()`) so a person's session never leaks into the shared secret-key client.
- **Assistant** (`workflows/ai-assistant`, `docs/adr/0004-orchestrateur.md`): XState v5 machine, one actor per objective, persisted on every transition with `getPersistedSnapshot()` (restoring re-runs an interrupted step; message ids are reserved before writing so replays don't duplicate). Every invoke has `onError` → back to `Ready For New Message` with `lastError`. The facade `SendMessageToAIWorkflow` returns `Result<WorkflowStateView>`, checks conversation ownership, rejects concurrent sends (`WORKFLOW_BUSY`), evicts idle actors. System instructions come from `SystemContextProvider`; tools and instructions are re-sent with tool results (Gemini Interactions only keeps history).
- **Composition** (`apps/api`): `adapters/production-adapters.module.ts` binds every port in `adapters/ports.ts` to Supabase/Gemini/Firestore; feature modules (`auth`, `objectives`, `conversation`, `assistant`) build use cases from ports with `useFactory`/`inject`. E2E tests swap the adapters module for in-memory doubles (`apps/api/test/support/test-app.ts`).
- **HTTP layer**: zod schemas per context (`*.schemas.ts`) validate via `@Body({ schema })` / `@Param(name, { schema })` + `StandardSchemaValidationPipe`, generate OpenAPI (`/docs`, `/docs-json`) and check responses in e2e tests. Errors are `{ error: { code, message, details? } }`; code → status in `http/api-error.ts`. Controllers return the use case output as is (`unwrap(result)`).
- **Test doubles**: each lib exposes in-memory fakes at `@org/<lib>/testing` (`src/testing.ts`), importable from tests only (lint rule). They mimic adapter semantics (owner filter, duplicate ids rejected like Postgres, creation order).

## Conventions

- NestJS classes: **always `@Inject(Token)` on constructor params**, and `import type` for types used in decorated signatures (lint rule `consistent-type-imports` in `apps/api`).
- File suffixes as in Apex: `*.usecase.ts`, `*.repository.ts`, `*.query.ts`, `*.command.ts`, `*.mapper.ts`, `*.error.ts`, `protocols/*.ts`; plus `*.module.ts`, `*.controller.ts`, `*.schemas.ts` in the app. Path aliases `@org/<lib>`.
- New SQL goes in `supabase/migrations/` with explicit GRANTs to `service_role` (new tables are no longer auto-exposed by Supabase).
- `docs/plan.md` tracks what's done and next; update it with significant changes.
