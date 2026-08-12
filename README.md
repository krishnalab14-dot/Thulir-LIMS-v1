# Thulir LIMS v1

A multi-tenant Laboratory Information Management System (LIMS). **Stage 1** covers **Patient Registration → Test/Package Order → Billing**; **Stage 2** adds **Sample Collection** (worklist, collect/reject with auto-recollection, printable labels); **Stage 2.5** extends the Test Master with the result model (numeric/options/text types, age/sex reference ranges, critical thresholds) that Result Entry will consume. Result entry, verification, approval, reporting, inventory and analytics are later stages.

> Full spec, done-criteria and architectural rules: see **[SETUP.md](./SETUP.md)**.

## Tech Stack

| Layer | Technology |
| ----- | ---------- |
| API | NestJS 11 + TypeScript (strict) |
| ORM | Prisma 6 + PostgreSQL |
| Web | React 19 + Vite 6 + Tailwind CSS + React Router 7 |
| Validation | `class-validator` DTOs (never plain interfaces) |
| Quality | ESLint 9 (flat) + Prettier + Jest/ts-jest |

Monorepo: **npm workspaces** → `apps/api`, `apps/web`.

## Quick Start (local)

```bash
# 1. Install workspace dependencies
npm install

# 2. Configure env (templates are committed as env.example — copy to .env)
cp apps/api/env.example apps/api/.env

# 3. Start PostgreSQL
docker compose up -d db

# 4. Create schema + seed (org, admin user, sample types, tests, packages, doctors)
npm run db:migrate
npm run db:seed

# 5. Run both dev servers (or two terminals: npm run dev:api / dev:web)
npm run dev
# API → http://localhost:3000/api  ·  Web → http://localhost:5173

# 6. Or run the whole stack in containers (Postgres + API + Web)
docker compose up --build
```

Seeded login (auth is a later stage — the user row exists for the future auth module): `admin` / `Thulir@123`.

## Environment Variables

| Variable | Where | Purpose |
| -------- | ----- | ------- |
| `DATABASE_URL` | `apps/api/.env` | PostgreSQL connection (Prisma) |
| `PORT` | `apps/api/.env` | API port (default `3000`, binds `0.0.0.0`) |
| `DEFAULT_ORG_ID` | `apps/api/.env` | Tenant used when no `x-organization-id` header is sent (until auth lands) |
| `VITE_API_URL` | `apps/web/.env` | Optional full API base URL (defaults to relative `/api` via the Vite dev proxy / nginx) |
| `VITE_ORG_ID` | `apps/web/.env` | Organization id header sent by the web app (default `org_demo`) |
| `SUPABASE_URL` | `apps/api/.env` | Supabase project URL (`https://<ref>.supabase.co`) — auth/storage backend |
| `SUPABASE_ANON_KEY` | `apps/api/.env` | Supabase public `anon` key |
| `SUPABASE_SERVICE_ROLE_KEY` | `apps/api/.env` | Supabase secret `service_role` key (server-side only) |
| `SUPABASE_PROJECT_REF` | `apps/api/.env` | Supabase project reference (from the project URL) |

Secrets are managed via the Freebuff Keys UI in hosted environments; never commit `.env` files.

## API Surface (Stage 1)

| Method | Endpoint | Purpose |
| ------ | -------- | ------- |
| GET | `/api/patients/check-duplicate?mobile=\|q=` | Duplicate detection during registration |
| POST | `/api/patients` | Create patient; auto-generates `patientUid` (`PREFIX-YYYY-NNNN`, collision-safe) |
| GET | `/api/masters/tests/search?q=` | Test typeahead (id, code, name, price, sample type) |
| GET | `/api/masters/tests` | Test catalog list |
| POST | `/api/masters/tests` | Create a minimal test |
| GET | `/api/masters/packages/search?q=` | Package typeahead (own `packagePrice` + constituent test names) |
| POST | `/api/masters/packages` | Inline package creation |
| GET | `/api/masters/sample-types` / POST | Sample type lookup |
| GET | `/api/parties/search?type=doctor&q=` / POST | Referral parties |
| POST | `/api/orders` | **Critical endpoint** — see §9 of SETUP.md (one transaction, server-side pricing, snapshots, split validation) |
| GET | `/api/orders` | Minimal order list (Stage 1 verification) |
| POST | `/api/invoices/:invoiceId/payments` | Additional payments, split-sum validated |

## Key Stage 1 Rules (summary)

- **Server-side pricing** — the order payload carries no prices; `forbidNonWhitelisted` rejects any stray price field, and client-sent `subtotal`/`total` are cross-checked and rejected on mismatch.
- **Snapshot principle** — `OrderTest` stores `snapshottedPrice`/`testNameSnapshot` at order time; never re-read live afterwards.
- **Fail-closed multi-tenancy** — a Prisma extension throws on any tenant-scoped query without a tenant context; the HTTP layer runs requests under the `x-organization-id` header or `DEFAULT_ORG_ID`.
- **Derived rollups** — `Order.status` is computed from `OrderTest` statuses (all new orders start `billed`).
- **Exact split validation** — payment splits must sum exactly to the amount being paid.
- **Package pricing** — a package bills at its OWN `packagePrice` (a bundled panel is priced independently of its parts). One `OrderTest` row per constituent test is still created (needed for Stage 2 result entry), with `packagePrice` distributed across those rows proportionally to each test's standalone price, so the snapshot sum always equals `packagePrice`. The order/invoice total never uses the sum of standalone `currentPrice` values.
- **Overlap prevention** — a test is never billed BOTH standalone and inside a package (double-billing guard). The web UI blocks the silent add (confirm-to-resolve for packages, hard block for standalone adds) and `POST /api/orders` rejects overlapping payloads with a 400.

## Quality Gates

```bash
npm run typecheck   # per-workspace tsc --noEmit
npm run lint        # ESLint 0 errors / 0 warnings
npm run build       # nest build + vite build
npm test            # API Jest unit suite + web unit tests (uid, duplicates, packages, overlap, billing, splits, tenant scoping, rollups)
npm run verify:real-db  # embedded PostgreSQL → migrate → seed → real-DB integration suite (9 tests) → state dump

CI (.github/workflows/ci.yml) runs typecheck/lint/unit/build on every push/PR **and** the real-DB verification, so the embedded-Postgres suite protects every future change automatically.
```

## Repository Layout

```
apps/api/            NestJS API + Prisma schema/seed/migrations
apps/web/            React 19 + Vite + Tailwind app
docker-compose.yml   Postgres + API + Web
types/               root-level ambient types (root tsc -b input)
```
