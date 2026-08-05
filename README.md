# Dine-In Cinema Platform

Cinema ticketing and seat-linked restaurant POS for an independent dine-in
theater. Start with `/docs/PRODUCT_SPEC.md` and `AGENTS.md` before touching
code — they're the source of truth this repo is built against.

Current status: **Milestone 1 in progress**. Milestone 0 is locally verified,
and the Movie data/API/admin creation vertical slice is implemented. Auditorium,
seat-layout, price-tier, showtime, and customer-listing work remains.

## Repository layout

```
/apps
  /customer-web   Next.js — public site, seat map, checkout, live tab (Milestone 1+)
  /staff-pos      Next.js — box office + server ordering
  /kds            Next.js — kitchen / bar display
  /admin          Next.js — manager dashboard
  /api            NestJS — the single backend service
/packages
  /database       Prisma schema, migrations, seed
  /shared         cross-cutting types/zod schemas/enums
  /ui             shared theme tokens
  /auth           permission catalog, password hashing, JWT sessions
  /payments /ticketing /restaurant /notifications   domain packages (empty until their milestone)
  /config         shared tsconfig, eslint, env validation
/docs             architecture & planning documents — read these first
/infra            docker-compose, deployment config
```

## Prerequisites

- Node.js 20+
- pnpm 9 (`corepack enable && corepack prepare pnpm@9 --activate`)
- Docker (for local Postgres/Redis via `infra/docker-compose.yml`)

## First-time setup

```bash
pnpm install                # also runs `prisma generate` via postinstall
docker compose -f infra/docker-compose.yml up -d
cp apps/api/.env.example apps/api/.env
# edit apps/api/.env: set real JWT_ACCESS_SECRET / JWT_REFRESH_SECRET
# (openssl rand -base64 48)

pnpm db:migrate              # applies Prisma migrations
pnpm db:seed                 # creates demo org/location/roles + test accounts

cp apps/customer-web/.env.local.example apps/customer-web/.env.local
cp apps/staff-pos/.env.local.example apps/staff-pos/.env.local
cp apps/kds/.env.local.example apps/kds/.env.local
cp apps/admin/.env.local.example apps/admin/.env.local
```

### Migration transition from `prisma db push`

The committed baseline migration is the source of truth for a **fresh database**. Point
`DATABASE_URL` at an empty database, then run `pnpm db:migrate` followed by
`pnpm db:seed` as shown above.

An **existing development database previously created with `prisma db push`** has
schema objects but no matching Prisma migration history, so applying the baseline
directly will fail. Back up that database and verify the backup before attempting any
recovery. The safest recovery path is to leave the existing database untouched, create
a new empty development database, apply the migrations and seed there, and transfer
only data that must be retained through a separately reviewed export/import process.
Do not run `prisma migrate reset`, drop the existing schema, or mark the baseline as
applied without first reconciling and verifying the complete schema; those shortcuts
can destroy data or leave the migration history inconsistent with the database.

## Running it

```bash
pnpm --filter @cinema/api dev        # NestJS on :4000
pnpm --filter @cinema/customer-web dev   # :3000
pnpm --filter @cinema/staff-pos dev      # :3001
pnpm --filter @cinema/kds dev            # :3002
pnpm --filter @cinema/admin dev          # :3003
```

Or all at once from the root: `pnpm dev` (Turborepo runs every app's `dev` script in parallel).

### Seeded test accounts (local/dev only — never real credentials)

| Role | Email | Password |
|---|---|---|
| Owner | owner@ridgelinecinema.test | `DevPassword123!` |
| Server | server@ridgelinecinema.test | `DevPassword123!` |
| Customer | customer@ridgelinecinema.test | `DevPassword123!` |

Log into `admin` or `staff-pos` with the Owner/Server accounts, `customer-web`
with the Customer account.

## Testing

```bash
pnpm test                         # unit tests, every package
pnpm --filter @cinema/api test:integration   # real Postgres, real HTTP, no mocks
```

The integration suite boots a real, ephemeral PostgreSQL instance per run
(`apps/api/test/test-db.ts`, via `embedded-postgres`) — no Docker required
to run it locally, though CI additionally has a real Postgres service
container available. See `AGENTS.md` §7 for why these tests never mock the
database.

**Note:** `pnpm install`'s postinstall step and the test suite both require
normal internet access the first time, to fetch Prisma's query engine
binary. This is a one-time download per machine/CI cache, not a recurring
requirement.

## Milestone 0 completion status

Per `/docs/IMPLEMENTATION_PLAN.md`'s Milestone 0 completion criteria:

- [x] Monorepo scaffold (pnpm workspaces + Turborepo), strict TypeScript throughout.
- [x] Prisma schema: Organization, Location, Employee, StaffAuthAccount, Role, Permission, RolePermission, EmployeeRole, Customer, CustomerAuthAccount, AuditEvent.
- [x] Environment validation that fails fast on boot if a required secret is missing.
- [x] Structured JSON logging.
- [x] Staff auth (login/refresh/logout) and customer auth (register/login/refresh/logout), argon2id password hashing, JWT sessions with refresh-token invalidation.
- [x] RBAC guard framework (`@RequirePermissions` + `PermissionsGuard`), enforced server-side, demonstrated against a real endpoint (`GET /audit-events`).
- [x] Audit logging wired into the same transaction as the actions it records.
- [x] All four frontend app shells, each with a real login screen against the live API.
- [x] Unit tests: password hashing, JWT issuance (`packages/auth`) — 8/8 passing, verified.
- [x] Integration tests: health check, staff/customer auth flows, RBAC enforcement (allow + deny), input validation — written against a real Postgres instance.
- [ ] **CI pipeline verified green.** The GitHub Actions workflow (`.github/workflows/ci.yml`) exists, but it has not been executed from this environment; its result remains unknown until it runs on GitHub.
- [x] **Automated local verification.** Prisma Client generation, lint, strict typecheck, unit tests, production builds, committed migration deployment to a fresh real PostgreSQL database, and the health/auth/RBAC/Movie API integration suite have been run successfully.
- [ ] **Manual live API/admin smoke test.** A multi-process browser walkthrough of Movie creation has not been performed. GitHub Actions also remains unverified until the workflow is run on GitHub.

See `/docs/OPEN_QUESTIONS.md` for the full list of assumptions and pending decisions.
