# Thulir LIMS — Setup & Environment Guide

> **THULIR03 v2 — Stage 1** · Patient Registration → Test/Package Order → Billing
>
> **Status: documentation only.** This repository is fresh and currently contains no application code. This document describes the setup that the Stage 1 build will follow; nothing below is implemented yet.

---

## 1. Project Overview

Thulir LIMS is a multi-tenant Laboratory Information Management System (LIMS). This build covers **Stage 1 only**:

- **Patient Registration** (full-page 4-step wizard)
- **Test / Package Order** with inline billing
- **Payment collection** against an order's invoice
- Minimal **Masters** screens (test catalog + package creation) — just enough to seed data and verify the order flow

**Explicitly out of scope for this stage** (later, separate prompts): Sample Collection, Result Entry, Verify/Approval, Reports, full Accounts/Daily-Collections UI, Inventory, Portals, QC, Analytics, Staff, Settings, Audit, and the full Test Master parameter model (result types, specifications, calculations). The `Payment`/`PaymentSplit` tables exist now so later stages need no schema change, but no Accounts UI is built.

---

## 2. Tech Stack

| Layer   | Technology |
| ------- | ---------- |
| API     | NestJS 11 (TypeScript) |
| ORM     | Prisma (PostgreSQL) |
| Database| PostgreSQL (via Docker Compose locally) |
| Web     | React 19 + Vite + Tailwind CSS |
| Validation | `class-validator`-based DTOs (never plain interfaces for request bodies) |
| Quality | ESLint + Prettier configured from day one |
| Tests   | Unit + e2e (NestJS testing defaults) |

**Monorepo layout:** npm workspaces with `apps/api` and `apps/web`.

---

## 3. Repository Layout (planned)

```
thulir-lims/
├── apps/
│   ├── api/                        # NestJS 11
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── seed.ts             # org + admin + sample tests/packages
│   │   │   └── extensions/         # fail-closed tenant-scoping extension
│   │   └── src/
│   │       ├── main.ts             # global ValidationPipe, CORS, 0.0.0.0 bind
│   │       ├── prisma/             # PrismaService + tenant extension wiring
│   │       ├── patients/           # register, duplicate-check, patientUid
│   │       ├── masters/            # tests / packages / sample-types search
│   │       ├── parties/            # doctor/hospital/corporate/insurance_tpa
│   │       ├── orders/             # POST /orders (critical billing logic)
│   │       └── invoices/           # payments + split validation
│   └── web/                        # React 19 + Vite + Tailwind
│       └── src/
│           ├── components/layout/  # horizontal top dropdown nav shell
│           ├── features/patients/  # 4-step registration wizard
│           ├── features/orders/    # order & billing screen
│           └── lib/                # API client
├── docker-compose.yml              # local PostgreSQL only
├── package.json                    # workspace root (scripts below)
├── eslint.config.* / .prettierrc
└── README.md
```

---

## 4. Prerequisites

- **Node.js 20.19+ or 22 LTS** (NestJS 11 / Vite requirement)
- **npm** (workspaces) — pnpm also fine if preferred
- **Docker + Docker Compose** (for local PostgreSQL)
- No other global tooling required

---

## 5. One-Time Local Setup

```bash
# 1. Install workspace dependencies (from repo root)
npm install

# 2. Copy environment files
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

# 3. Start local PostgreSQL
docker compose up -d

# 4. Create / apply the database schema (Stage 1 tables)
npm run db:migrate          # = npx prisma migrate dev (from apps/api)

# 5. Seed: organization + admin user + sample sample-types/tests/packages + a doctor party
npm run db:seed

# 6. Run both dev servers (two terminals, or `npm run dev`)
npm run dev:api             # http://localhost:3000
npm run dev:web             # http://localhost:5173
```

> **Sandbox/preview note:** in hosted previews the API dev server must bind to `0.0.0.0` (NestJS `app.listen(PORT, '0.0.0.0')`) so the platform can route to it. The web dev server uses Vite's `--host 0.0.0.0` as well.

---

## 6. Environment Variables

| Variable | Used by | Example / Notes |
| -------- | ------- | --------------- |
| `DATABASE_URL` | API (Prisma) | `postgresql://thulir:thulir@localhost:5432/thulir_lims?schema=public` |
| `PORT` | API | `3000` |
| `VITE_API_URL` | Web | `http://localhost:3000/api` (or a Vite dev proxy `/api` → `:3000`) |
| `JWT_SECRET` | later stage | Not needed for Stage 1 (auth endpoints are not in this stage) |

Secrets are managed via the Freebuff Keys/API-keys UI in hosted environments; never commit `.env` files. `apps/api/.env.example` should list only the keys above.

---

## 7. Database Schema (Stage 1 tables only)

Defined exactly per spec: `Organization`, `User`, `Patient`, `MasterTest`, `MasterTestPackage`, `MasterTestPackageItem`, `SampleType`, `Party`, `Order`, `OrderTest`, `Invoice`, `Payment`, `PaymentSplit`.

- **Multi-tenancy:** every model with `organizationId` is guarded by a **fail-closed Prisma extension** — any tenant-scoped query without a tenant context in scope throws instead of silently returning cross-tenant data. Built from the first migration, not bolted on later.
- **`patientUid`:** auto-generated `<org-prefix>-<year>-<sequential>` (e.g. `THL-2026-0001`), collision-safe under concurrent registration (DB sequence or retry-on-conflict).
- **Age/DOB:** pick one primary source of truth at registration and derive the other.
- **`Order.status` rollup:** derived from the set of `OrderTest.status` values (`pending → entered → verified → approved`), computed on read or updated transactionally on every `OrderTest` change — never independently settable.

---

## 8. API Surface (Stage 1)

| Method | Endpoint | Purpose |
| ------ | -------- | ------- |
| GET  | `/api/patients/check-duplicate?mobile=<number>` | Duplicate-warning prompt during registration |
| POST | `/api/patients` | Create patient; auto-generate `patientUid` |
| GET  | `/api/masters/tests/search?q=<term>` | Typeahead: `id, code, name, price, requiredSampleTypeId` only |
| GET  | `/api/masters/packages/search?q=<term>` | Typeahead for packages |
| POST | `/api/masters/packages` | Inline package creation (name, price, array of test IDs) |
| POST | `/api/orders` | **Critical endpoint** — see §9 |
| POST | `/api/invoices/:invoiceId/payments` | Additional payment against a due/partial invoice |

All request bodies are validated with `class-validator` DTOs. Request bodies for order creation carry **no prices** — pricing is always resolved server-side.

---

## 9. Order Creation Logic (`POST /api/orders`)

All steps run inside **one transaction**:

1. If `patient.patientId` is null → create patient (duplicate-check + auto-ID); else link existing.
2. Resolve `testIds` + expand `packageIds` into line items; **look up prices from the DB** — standalone tests at `MasterTest.currentPrice`, packages at their OWN `MasterTestPackage.packagePrice` (distributed across the package's `OrderTest` rows). Any price field sent by the frontend is ignored.
3. Compute `subtotal` server-side; apply `discountPercent` (validated 0–100) → `totalAmount`.
4. **Cross-verify:** if the frontend ever sends `subtotal`/`total`, recompute independently and reject on mismatch (deliberate defense-in-depth, documented).
5. Create `Order` + one `OrderTest` per resolved test with `snapshottedPrice` / `testNameSnapshot` captured **at this exact moment** — never re-read live from `MasterTest` afterwards.
6. Create `Invoice`.
7. If `payment.splits` provided → create `Payment` + `PaymentSplit` rows; **splits must sum exactly to the amount being paid, else reject**. Set `Invoice.status` → `paid` / `partial` / `due`.
8. Return the created order with its invoice.

---

## 10. Frontend Pages (Stage 1)

- **Navigation shell (built once):** horizontal top dropdown menu bar — top-level items (Operations, Masters, Parties, Staff, Inventory, Analytics, Settings, Audit) each opening a simple dropdown. No persistent left sidebar; high-information-density, minimalist styling.
- **Patient Registration:** full-page multi-step wizard — ① Identify (search name/phone/MRN, results, "Register New Patient"), ② Demographics (Name\*, DOB or Age\*, Gender\*, Mobile\*, Email, Address, external MRN, ABHA), ③ Order & Billing, ④ Done (confirmation + patient ID, print label/receipt option). Mandatory fields marked `*`.
- **Order & Billing (step ③):** "Add Test" + "Add Package" typeahead search boxes; running line-item list with prices and remove; **"Create Package from Selection"** (enabled when 2+ tests selected and no matching package exists; inline dialog with name+price, replaces line items); live totals (Subtotal → Discount % → Total); payment section with per-mode amounts (Cash/UPI/Card/Bank Transfer/Insurance), running "Total Entered" must equal "Total Due" client-side (server re-checks); referring-doctor typeahead against `Party` (type=doctor, optional).
- **Minimal Masters screens:** bare test list/create form (code, name, price, required sample type) — just enough to seed and verify. Full Masters module is a later stage.

---

## 11. Validation & Quality Gates

```bash
npm run typecheck   # tsc -b clean
npm run lint        # 0 errors
npm run build       # both apps build
npm test            # unit + e2e
```

**Regression tests required for Stage 1 done:**
1. `patientUid` generation / collision safety
2. Duplicate detection
3. Package-from-selection creation
4. Order billing validation (discount bounds + subtotal cross-check)
5. Payment-split-sum validation
6. Fail-closed tenant scoping (query without tenant context throws)

---

## 12. Stage 1 Done-Criteria (acceptance walkthrough)

- [ ] Fresh repo scaffolds; `docker compose up` brings up Postgres + API + Web cleanly
- [ ] Register patient with only mandatory fields → succeeds, `patientUid` correct
- [ ] Register with every optional field → persists and reloads correctly
- [ ] Repeated mobile number triggers duplicate-check flow → existing patient surfaced
- [ ] Add 2 individual tests with no matching package → "Create Package from Selection" works; new package appears in a fresh search immediately and is reusable on a second order
- [ ] Order with `discountPercent: 150` → rejected server-side
- [ ] Tampered frontend subtotal that doesn't match server computation → rejected
- [ ] Split ₹800 Cash + ₹200 UPI against ₹1000 order → `Invoice.status = paid`, both `PaymentSplit` rows exist
- [ ] Split that doesn't sum to amount being paid → rejected server-side
- [ ] `OrderTest.status` starts `pending` for every line item; `Order.status` rollup starts `billed`
- [ ] Tenant-scoped query with no tenant context → throws
- [ ] `tsc -b` clean, lint 0 errors, build passes, all regression tests green

---

## 13. Key Architectural Rules (non-negotiable)

1. **Server-side pricing:** the frontend never sends prices; all amounts are computed in the backend from DB lookups inside the order transaction.
2. **Snapshot principle:** `OrderTest` captures `snapshottedPrice` + `testNameSnapshot` at order time; never re-read live afterward.
3. **Fail-closed tenant scoping:** tenant-scoped queries without a tenant context throw (Prisma extension from the first migration).
4. **DTOs over interfaces:** every request body is a `class-validator` DTO — never a plain interface.
5. **Derived rollups:** `Order.status` is computed from `OrderTest` statuses; never independently settable.
6. **Exact split validation:** payment splits must sum exactly to the amount being paid, server-side.

---

## 14. Implementation Notes (Stage 1 build — review these before Stage 2)

This section records the deliberate decisions the Stage 1 implementation made where the spec left room. Review point-by-point before Stage 2 (Sample Collection) begins.

### 14.1 Package billing — packages bill at their OWN price (revised by the Stage 1 review pass)
**Superseded decision (original build):** packages expanded to their constituent tests and billed at each test's `MasterTest.currentPrice`; `packagePrice` was treated as a catalog/display value only.

**Current decision (review pass, §15.1):** `MasterTestPackage.packagePrice` is the authoritative billing price. A package still produces one `OrderTest` row per constituent test (Stage 2 Result Entry needs a row per test), but `packagePrice` is **distributed across those rows proportionally to each test's standalone price** (`distributePackagePrice` in `apps/api/src/orders/package-pricing.util.ts`), with the 2dp rounding residual applied to the largest share so the distributed values **sum exactly to `packagePrice`**. The order subtotal/total therefore always reflect `packagePrice`, never the sum of standalone prices. E.g. tests priced 700 + 500 (sum 1200) in a package priced 900 → two OrderTest rows at 525 + 375.

**Overlap rule (Stage 1 follow-up, §16):** a test must NEVER be billed both standalone AND inside a package. The frontend blocks the silent add (confirm-to-resolve for packages, hard block for standalone) and `POST /api/orders` rejects any overlapping payload with a 400. A standalone test and a package may coexist only when their item sets are disjoint.

### 14.2 patientUid generation — DB-level sequence, not retries
The spec allows a DB sequence or retry-on-conflict. This build uses a dedicated `UidCounter` table incremented with a single atomic `INSERT ... ON CONFLICT ... RETURNING` (see `apps/api/src/patients/patient-uid.util.ts`), so concurrent registrations serialize on the row lock and can never observe the same counter — collision-safe by construction. Prefix = first 3 alphabetic characters of the org name (e.g. `Thulir Demo Lab` → `THU-2026-0001`).

### 14.3 DOB is the single source of truth
When a DOB is provided, `ageAtRegistration` is derived from it; when only an age is given it is stored as-is with no DOB (`resolveDobAndAge`).

### 14.4 Tenant context until auth lands
Auth (User/Role/JWT) is a later stage. `TenantMiddleware` runs every request inside `AsyncLocalStorage` using the `x-organization-id` header or `DEFAULT_ORG_ID` (seeded org is `org_demo`). The Prisma extension remains fail-closed regardless — bypassing the middleware still throws.

### 14.5 Payment split-sum semantics
Order/invoice payloads carry only `splits` (per the spec shape). An optional `amount` field is also accepted: when present, the server rejects the payment unless `sum(splits) === amount` (this is what the "split that doesn't sum → rejected" done-criteria exercises); when absent, the sum of the splits is the amount being paid. `Invoice.status`: `paid` when cumulative paid ≥ total, `partial` when > 0, else `due`.

### 14.6 Small beyond-spec additions (flagged)
To verify the flow end-to-end, these minimal additions exist and are documented as such:
- `GET /api/orders` (read-only order list) + the web **Orders** page
- `GET /api/masters/tests`, `POST /api/masters/tests`, `GET/POST /api/masters/sample-types`, `GET/POST /api/parties` — the bare minimum to seed and exercise the catalog (spec: "build only what's needed to test Stage 1")
- `check-duplicate` also accepts `q` (name/MRN/patientUid) to power the wizard's name/phone/MRN search box

### 14.7 Validation status (all green)
`npm run typecheck` ✓ · `npm run lint` (0 errors/warnings) ✓ · `npm run build` ✓ · `npm test` — 8 API suites / **54 unit tests** + **11 web unit tests** (node:test, overlap-prevention rules) covering: patientUid generation & collision safety, duplicate detection, package-from-selection creation, package-price distribution, overlap prevention, discount bounds + subtotal/total cross-check, payment split-sum validation, invoice status derivation, order rollup, and fail-closed tenant scoping ✓ · `npm run verify:real-db` — **9/9 integration tests against real PostgreSQL** (see §15/§16) ✓ · API boots clean (`Thulir API listening on 0.0.0.0:3000`) with all routes mapped ✓

## 15. Stage 1 Review Pass — Package Pricing + Real-DB Verification

### 15.1 Package pricing: WAS WRONG, now fixed
`POST /api/orders` previously expanded packages and billed at the sum of constituent `MasterTest.currentPrice` values (the `packagePrice` field never reached the invoice). Per the review, this was corrected: a package now bills at its OWN `packagePrice`, distributed across its constituent `OrderTest` rows proportionally to standalone prices (exact-sum, 2dp — see §14.1 and `apps/api/src/orders/package-pricing.util.ts`). Regression tests added: the review's exact scenario (tests summing ₹1200 individually, package priced ₹900 → billed ₹900) plus standalone+package mix and single-test package. Verified end-to-end against the real DB: a package of two tests priced 700+500 (₹1200 standalone) at `packagePrice` 900 produced OrderTest snapshots of 525 + 375 and an invoice subtotal of 900.

### 15.2 Real-DB verification: PASSED (8/8 integration tests)
Docker is unavailable in this sandbox, so (per the approved route) the verification used the **`embedded-postgres` npm package** — real PostgreSQL 18.4 binaries inside `node_modules`, no system packages. `npm run verify:real-db` (added to the repo) runs the whole sequence in one bounded command:

1. **Start embedded PostgreSQL** — `initdb` + server on `127.0.0.1:5432`, database `thulir_lims` ✓
2. **`prisma migrate deploy`** — `20260810000000_init` applied cleanly (all tables, enums, indexes, FKs) ✓
3. **`npm run db:seed`** — org_demo + 5 sample types + 12 tests + 2 packages + 5 parties + admin ✓
4. **Integration suite (real DB, real HTTP)** — 8/8 pass: patient registration + `patientUid` (`THU-2026-0001` format) + duplicate-check; catalog creation; `POST /api/orders` with package + standalone test + split payment landing in `Order` (subtotal 1600, total 1440, status `billed`), `OrderTest` (3 rows, snapshots 700/525/375, all `pending`), `Invoice` (`paid`), `Payment` (`collectedBy=system`), `PaymentSplit` (cash:900, upi:540); `discountPercent: 150` → 400; tampered client subtotal → 400; split-sum mismatch → 400; `POST /api/invoices/:id/payments` due→partial; fail-closed tenant scoping on the real connection (no context throws, cross-tenant read/write/update throws)
5. **Unit suite** — 51/51 still green with the real DB present ✓
6. **DB state dump** — printed row-level proof (§ above) ✓

Note: PostgreSQL refuses to run as root, so the verification runs under a non-root sandbox user (`thulirpg`) via `runuser`; `chmod o+x /home/daytona` was required so that user can traverse to the repo. No Docker/Postgres packages were installed on the host.

### 15.3 Bugs the real-DB run caught (both fixed)
- **Tenant extension `update`/`delete`/`upsert` were broken on the transaction client.** The original `Prisma.getExtensionContext(this)[model]` pattern returns `undefined` for model delegates in `$allOperations` hooks (`this` is an internal array), so every tenant-scoped `update` (e.g. setting `Invoice.status = paid`) threw `TypeError` → 500. Fixed in `tenant-scope.extension.ts`: ownership pre-check via a plain unextended `PrismaClient` closed over by the factory, PLUS post-verify of the actually-affected row (a separate connection cannot see rows created earlier in the same interactive transaction — the second real-DB catch).
- **e2e payload gap** (test-side): new-patient order payloads must include `dob` or `age` (the DTO requires DOB-or-age). The frontend always sends one; the first integration draft omitted it.

### 15.4 Tenant context mechanism today (for Stage 2)
No auth/login exists yet. `TenantMiddleware` (registered for every route) resolves the organization from the **`x-organization-id` request header**, falling back to `DEFAULT_ORG_ID` (env, seeded org = `org_demo`), and runs the request inside `TenantContextService.run(orgId, ...)` (AsyncLocalStorage). The web app sends `x-organization-id` from `VITE_ORG_ID` (default `org_demo` — see `apps/web/src/lib/api.ts`). User-scoped columns (`createdBy`, `collectedBy`) are stamped with the placeholder `SYSTEM_USER_ID = 'system'` from `apps/api/src/common/constants.ts`. Stage 2 (Sample Collection) should keep using this same mechanism — `collectedBy` will swap to the authenticated user's id once the auth stage lands.

## 16. Stage 1 Follow-up — Overlap Prevention + CI for Real-DB Tests

### 16.1 Overlap prevention: a test is never billed both standalone and inside a package
Double-billing bug: adding Urea standalone, then a package that also contains Urea, billed Urea twice (once standalone, once inside the package's distributed price). Fixed in both layers:

- **Frontend** (`apps/web/src/pages/OrderBillingStep.tsx` + pure rules in `apps/web/src/lib/order-overlap.ts`):
  - Adding a package whose constituents overlap already-selected standalone tests → blocked with an inline message naming the test(s), plus an explicit **"Add package & remove duplicate(s)"** confirm (removes the standalone item, adds the package at `packagePrice`) or **Cancel**. Never merged silently.
  - Adding a standalone test already covered by a selected package → blocked outright: *"Urea is already included in the \"RFT\" package you've added."* Nothing to confirm — the test is already on the order.
  - The rules are pure, unit-tested functions (11 node:test cases) — no DOM needed.
- **Server** (`apps/api/src/orders/orders.service.ts`): `POST /api/orders` rejects any payload that still overlaps (e.g. a tampered client) with a 400 naming each conflict (`'Urea' is ordered both standalone and inside package 'RFT'`), inside the same transaction → no rows persist. Reject, never silently merge — consistent with the rest of the billing validation.
- Regression coverage: 2 API unit tests (reject single + multiple conflicts, no order created) + 1 real-DB e2e test (400, `Order` count unchanged) + 11 web unit tests for the frontend rules. The existing e2e success case was updated to use a disjoint standalone test (Gamma 800 + package 900 → subtotal 1700, total 1530, splits cash:900 + upi:630).

### 16.2 CI now runs the real-DB verification on every push/PR
`.github/workflows/ci.yml` gained the **Real-DB integration** job (`npm run verify:real-db` — embedded Postgres → migrate → seed → integration tests → unit tests) alongside the existing validate job (typecheck/lint/unit tests/build). Both run on every push to `main` and every PR. The existing jobs are unchanged except that `npm test` now also runs the web unit tests.

**Root-user workaround does NOT apply to CI.** GitHub Actions runners are non-root, so embedded-postgres runs directly — the `runuser -u thulirpg` dance in this sandbox is only needed because the Freebuff sandbox runs as root (PostgreSQL refuses root). CI needs no such handling (confirmed: both CI runs green, ~35s).

### 16.3 Validation after this pass
`npm run typecheck` ✓ · `npm run lint` ✓ · `npm run build` ✓ · API unit 54/54 ✓ · web unit 11/11 ✓ · `npm run verify:real-db` 9/9 integration + 54/54 unit against real PostgreSQL ✓ · CI green on GitHub Actions.

## 17. Freebuff preview commands (documented — CLI unavailable in this sandbox)
The `freebuff-preview` CLI is not present in this workspace, so the commands below could not be registered via the tooling. They are exactly what the platform would register once the CLI is available (the root scripts already exist in `package.json`):

```bash
freebuff-preview set-install "npm install"
freebuff-preview set "npm run dev" 5173      # runs API (:3000) + Web (:5173) via concurrently; both bind 0.0.0.0
freebuff-preview set-build "npm run build"
```

Note: the API needs a reachable PostgreSQL (`DATABASE_URL`) — in hosted previews set it via the Keys/API-keys UI (env name `DATABASE_URL`), or run `docker compose up -d db` locally. The web UI renders regardless; API-backed data requires the DB.

## 18. Stage 1 Gate — Concurrency Verification (real Postgres, Promise.all)

Added `apps/api/test-e2e/concurrency.e2e-real-db.spec.ts` — a genuine parallel-load test against the real embedded Postgres (not mocked, not a sequential loop). It fires two full bursts via `Promise.all` through the real HTTP stack:

1. **20 patient registrations in parallel** (`POST /api/patients`) → all 201, `patientUid` values `THU-2026-0001…0020` with **zero collisions** (Set size 20), **gapless strictly-sequential numbering** (counter started at 1; each next = prev + 1), all 20 rows persisted.
2. **20 order creations in parallel** (`POST /api/orders`), each registering its inline patient in the same transaction (the maximum-contention path — 20 transactions contending for the single `UidCounter` row) → all 201, **zero creation errors**, **no deadlocks** (no P2034 write-conflict/deadlock, no P2002 collision), 4 `OrderTest` rows per order all `pending`, invoices `paid` with exact 2-way splits (cash + upi = subtotal), and per-order snapshot sums equal the server-computed subtotal (package billed at its own price). DB verified directly: 20 orders / 80 `OrderTest` / 20 invoices / 40 `PaymentSplit` rows, all correctly shaped.

Why it cannot fail silently: `patientUid` uses a single atomic `INSERT … ON CONFLICT … RETURNING` on the `UidCounter` row (see §14.2) — concurrent writers serialize on the row lock, so duplicates are impossible by construction and the numbering is provably gapless. A deadlock would surface as a non-2xx response and fail the suite.

Result: **2/2 concurrency tests pass against real PostgreSQL 18.4** (part of `npm run verify:real-db`, now 11 integration tests; also runs in CI's real-db job). Full suite after this pass: integration 11/11 ✓ · unit 54/54 ✓ · typecheck ✓ · lint ✓. The Stage 1 gate is cleared — ready for the Stage 2 (Sample Collection) spec.

**CI pool fix (this pass):** on GitHub Actions' 2-core runner, Prisma's default pool (`num_cpus * 2 + 1`) is only ~5 — the 20-request burst then trips **P2028** ("Unable to start a transaction in the given time", Prisma's 2s transaction-start `maxWait`) and the concurrency spec fails. `verify-real-db.ts` now appends `connection_limit=25` to the URL it builds so the burst always has headroom (embedded Postgres' default `max_connections` is 100). This only affects the verification harness; production deployments size their own pool via their real `DATABASE_URL`.

## 19. Stage 2 — Sample Collection (build record, review before Stage 3)

### 19.1 Schema
Migration `20260812000000_add_sample_collection`: `Sample` model (org-scoped, barcode `@unique`, status `pending_collection/collected/rejected`, collect + reject actor/timestamp columns, `recollectionOfSampleId` self-relation), `SampleStatus`/`RejectionReason` enums, `OrderTest.sampleId` (nullable FK → Sample), `SampleType.code` (nullable; barcode falls back to a name-derived code). `Sample` is in the tenant-scoping allowlist in the same commit.

### 19.2 Order transaction extension
`POST /api/orders` now creates **one Sample per distinct required sample type** among the ordered tests (CBC + LFT sharing a tube → one Sample), all `pending_collection`, and links every `OrderTest` to its Sample. Barcodes are deterministic (`<order.id uppercased>-<sampleType.code>`), generated inside the order transaction.

> **Bug found by the Stage 1 concurrency test (fixed):** the barcode originally used `order.id.slice(0, 8)` as the "short form", but cuid v2's first 8 characters encode the creation timestamp — under the 20-parallel-order burst, same-millisecond orders shared that prefix and 3 orders 500'd on the `barcodeValue` unique constraint. The barcode now uses the **full order id** (unique by construction), so barcodes are unique by construction; the DB constraint remains as the safety net.

### 19.3 Endpoints
- `GET /api/samples/pending` — pending_collection samples, oldest-first, joined with patient/order/urgency/sample-type for the worklist
- `PUT /api/samples/:id/collect` — **conditional update** (`WHERE id AND status = pending_collection`); zero rows affected → **409** (never a silent success or generic error). Sets `collectedBy` (`SYSTEM_USER_ID` until auth) + `collectedAt`
- `PUT /api/samples/:id/reject` — one transaction: conditional update → rejected (409 if not pending) → auto-create recollection (`-R2`/`-R3`… suffix, `recollectionOfSampleId` → rejected row) → re-link the affected `OrderTest` rows to the recollection. **Never touches Order/Invoice/Payment** (verified in the e2e). `note` required server-side when `reason = other` (400 otherwise)
- `GET /api/samples/:id` — full lifecycle + recollection **chain** (root → latest, both-direction walk; strictly linear because a rejected sample can't be rejected again)
- `GET /api/samples/:id/label` — printable label data (barcode, patient, sample type, order, lab name)
- `GET /api/orders/:id` — minimal order detail incl. a `samples` section (Stage 2 addition)

### 19.4 Frontend
`/collection` (Collection Worklist — scan-or-type barcode input that resolves on Enter, per-row Collect/Reject, reject dialog with the 6 fixed reasons + conditional note, recollection banner after reject so the new label is never silently hidden), `/samples/:id` (Sample Detail — lifecycle, ordered tests, recollection chain, Print Label via the existing `.print-area` print stylesheet), `/orders/:id` (Order Detail with a Samples section). Orders rows link to the detail page.

### 19.5 Concurrency + real-DB verification (all green)
New `test-e2e/samples.e2e-real-db.spec.ts` (9 tests, runs in `verify:real-db` + CI): order→samples creation (2 tube types → 2 Samples, deterministic barcodes, OrderTest links), worklist contents/ordering, collect with actor/timestamp + removal from worklist, **double-collect race (Promise.all) → exactly one 200 + one 409** with a single `collectedAt`, reject `other`-without-note → 400, reject → recollection `-R2` + re-link + billing untouched, reject again → `-R3` + 3-level chain visible from both the original and the middle node, label endpoint, and fail-closed tenant scoping on `Sample` (no context throws; cross-tenant collect attempt is a safe 409, no mutation).

Full suite after Stage 2: **integration 21/21** (concurrency 2 + orders 9 + samples 10) · **unit 58/58** (incl. 4 barcode-util tests) · typecheck ✓ · lint 0 ✓ · build (api + web) ✓ · `verify:real-db` end-to-end ✓ · CI green.

## 20. Stage 2 Follow-up — Per-Test Dedicated Sample Override (build record)

### 20.1 Schema
Migration `20260812000001_requires_dedicated_sample`: `MasterTest.requiresDedicatedSample BOOLEAN NOT NULL DEFAULT false` — additive, non-breaking. `false` (default) preserves Stage 2 behavior exactly (shares a tube with other tests of the same sample type); `true` means the test always gets its own dedicated `Sample`/tube, even when another test on the same order has the identical `sampleTypeId`.

### 20.2 Grouping rule (in the `POST /api/orders` transaction)
1. Resolved line items are split by the flag. Non-dedicated tests group by `sampleTypeId` exactly as before — one shared `Sample` per distinct type. Dedicated tests each get their own `Sample`, never grouped with each other or with the shared group.
2. Dedicated barcodes append the **full test id**: `<order.id uppercased>-<sampleType.code>-<test.id uppercased>`. The full id (never a truncated slice) is used for the same reason as the order id in §19.2 — cuid's leading characters are timestamp-derived, so truncation would re-introduce the same-millisecond collision. A shared sample's `-R2` recollection and a dedicated barcode can never collide (format separation).
3. If the same dedicated test appears twice in one order (e.g. the same test inside two overlapping packages), it is deduped to one `Sample` — the same physical tube — so barcode uniqueness remains guaranteed by construction.
4. Rejection of a dedicated sample recollects with the suffix after the test id (`…-<test.id>-R2`, `-R3`…), re-links only that sample's `OrderTest` rows, and never touches billing — identical semantics to the shared-sample path.

### 20.3 Masters
`POST /api/masters/tests` accepts `requiresDedicatedSample` (boolean, optional, defaults false); the Masters page's Add-Test form has a "Requires dedicated sample tube" checkbox (default unchecked) and the catalog table shows a dedicated/shared tube badge. Seed marks HBA1C (EDTA) and TSH (serum) as dedicated so the seed catalog itself exercises both paths.

### 20.4 Real-DB verification (all green)
New `test-e2e/dedicated-samples.e2e-real-db.spec.ts` (4 tests) against real Postgres: scenario 2 (shared + dedicated same type → exactly 2 Samples, correct `OrderTest.sampleId` links, distinct barcodes, flag persisted through the API with default false preserved), scenario 3 (shared + two dedicated same type → exactly 3 Samples — the two dedicated tests never grouped), dedicated-vs-shared barcode format separation, and reject-dedicated → `-R2` recollection + selective re-link + billing untouched. The concurrency spec now prefers a dedicated standalone test in its 20-parallel-order burst and asserts **zero barcode collisions** across all orders' samples.

Full suite after this pass: **integration 25/25** (concurrency 2 + orders 9 + samples 10 + dedicated 4) · **unit 61/61** (barcode util now 7 tests) · typecheck ✓ · lint 0 ✓ · build ✓ · `verify:real-db` end-to-end ✓. Scenario 1 (two shared tests same type → 1 Sample) is asserted by the unchanged Stage 2 samples suite. CI is green on push.

## 21. Stage 1 Follow-up 2 — Package-vs-Package Overlap Prevention (build record)

### 21.1 The gap
Standalone-vs-package overlap was already blocked (Stage 1 follow-up, §16); two **distinct packages** sharing a constituent test (RFT and Kidney Panel both containing Creatinine) were not — both could be added, silently billing the shared test twice across two independently-priced bundles.

### 21.2 Resolution: block + explicit swap, never a partial merge
There is no safe way to "remove just that test" from either fixed-price bundle without inventing a price-redistribution rule that would make the package no longer cost its stated price. So:
- **Frontend** (`apps/web/src/lib/order-overlap.ts` rule 3): adding a package whose constituents overlap an already-selected package is blocked with an inline message naming the shared test(s) and the covering package(s) ("Creatinine is already included in \"RFT\" (already added to this order). Remove \"RFT\" first if you want to add \"Kidney Panel\" instead."), plus exactly two actions: **"Remove [A] & add [B]"** (drops every overlapping existing package line AND standalone tests the new package covers — they're now priced as part of the bundle — then adds the new package fresh) or **Cancel** (nothing changes). Checked *before* the standalone rule: a standalone-confirm would still leave the package-vs-package conflict in place.
- **Backend** (`resolveOrderItems` in `POST /api/orders`): the existing conflict scan now also compares every selected package against every other selected package; a shared constituent → `400` naming both packages and the test (`'Creatinine' is included in both package 'RFT' and package 'Kidney Panel'`), nothing persisted. The server remains the source of truth for a bypassed frontend.

### 21.3 Regression tests (all green, real Postgres)
- Frontend unit (`order-overlap.spec.ts`, +8): detection (single/multiple overlapping packages, no false positives), swap-resolution removal, exact swap-message strings.
- `orders.e2e-real-db.spec.ts` (+2): creates a second package overlapping the first via the API, then rejects a both-packages order with the correct message and **zero persisted rows**.
- New `package-swap.e2e-real-db.spec.ts` (3 tests): the post-swap payload (only Package B) creates **exactly** Package B's `OrderTest` rows + `Sample`s, priced at B's own price distributed (Creatinine 560 + Glucose 140 = 700) and grouped fresh per the §20 rules (dedicated Creatinine tube, shared Glucose tube) with no residue from Package A; the pre-swap order (Package A) is completely untouched (Cancel semantics — its rows, samples, billing intact); a direct both-packages request is rejected with nothing persisted. The packages deliberately include a dedicated + a shared test so the swap path is verified against the §20 grouping rules.
- Existing standalone+package overlap test passes unmodified (the check was extended, not replaced).

Full suite after this pass: **integration 30/30** (concurrency 2 + orders 11 + samples 10 + dedicated 4 + package-swap 3) · **unit 61/61** · web unit 18/18 · typecheck ✓ · lint 0 ✓ · build (api + web) ✓ · `verify:real-db` end-to-end ✓. CI green on push.

## 22. Stage 2.5 — Test Master Extension: Result Type + Age/Sex Ranges + Critical Range (build record)

### 22.1 Schema + enum decision
Migration `20260812000002_test_master_extension`: `MasterTest` gains `resultType` (enum `ResultType`: `numeric`/`options`/`text`, default `numeric`), `resultOptions TEXT[]`, `defaultRefLow/High`, `criticalLow/High` (all nullable); new tenant-scoped `TestSpecification` model (ageMinYears/ageMaxYears, `sex` nullable = any sex, refLow/refHigh, FK → MasterTest); `OrderTest` gains six nullable snapshot columns (`snapshottedResultType`, `snapshottedResultOptions JSONB`, `snapshottedRefLow/High`, `snapshottedCriticalLow/High`). SQL generated by diffing the committed migrations against the updated schema on a live embedded Postgres (same pattern as Stages 2/2.1).

**Sex/Gender decision (explicit, per spec §1):** the spec's proposed `Sex` enum has the identical value set to Stage 1's `Patient.gender` `Gender` enum (`male`/`female`/`other`), so **no near-duplicate enum was created** — `TestSpecification.sex` reuses `Gender` and patient `gender` maps 1:1 into it (documented in the schema).

**Tenant scoping:** `TestSpecification` added to the fail-closed allowlist in the same commit, with a real-DB fail-closed assertion (no context throws; cross-tenant create throws, nothing persisted).

### 22.2 Range resolution (§2) + order-transaction extension
`resolveReferenceRange` (`apps/api/src/masters/reference-range.util.ts`): given the patient's age in years (DOB recomputed at order time — `patientAgeYears`; falls back to `ageAtRegistration` when no DOB was captured — same source-of-truth chain as Stage 1) and sex, resolve in order: exact age+sex spec → any-sex spec for the age range → default range → **reject the order** if a numeric test still has no complete range (never snapshots null). Age bounds inclusive. Overlap validation (`specificationsOverlap`) is a Masters-side data-entry guard: same sex resolution tier (both any-sex or same exact sex) + intersecting age ranges → rejected at save with a message naming the conflict — different tiers never conflict because runtime resolution prioritizes exact-sex over any-sex, so Result Entry never needs to disambiguate.

`POST /api/orders` now snapshots, at the exact moment each `OrderTest` is created: `snapshottedResultType` (always), `snapshottedResultOptions` (only for options-type), `snapshottedRefLow/High` (resolved per §2, numeric only), `snapshottedCriticalLow/High` (copied directly from `MasterTest` — captured now for a later alerting stage, not resolution-dependent). Same non-negotiable snapshot principle as price: never re-read live afterwards. A numeric test with no default and no matching spec for this patient → `400` naming the test, order not created. Seed catalog updated so every numeric test carries a default range (rule 4 rejects ordering a rangeless numeric test), Blood Group is now an options-type test, and Urine Routine is text — the seed spans all three `ResultType` values.

### 22.3 Masters API + UI
`POST /api/masters/tests` accepts the new fields via `class-validator` DTOs (nested `TestSpecificationDto`): `resultType`, `resultOptions` (non-empty enforced for options-type), `defaultRefLow/High`, `criticalLow/High`, `specifications[]` — created transactionally with overlap + bounds validation (ageMin ≤ ageMax, refLow ≤ refHigh). `GET /api/masters/tests` returns the new fields + specifications for reload verification.

Masters page (`MastersTests.tsx`): Result Type selector (Numeric/Options/Text); Numeric shows a Reference Range block, a **red-accented Critical Low/High alerting sub-section**, and an **Age/Sex Specifications sub-table** (add/edit/remove rows: min–max years, sex dropdown incl. Any, low/high); Options shows a chip tag-input; Text shows nothing extra. The catalog table shows a per-row result-type badge (Numeric blue / Options violet / Text slate). Server overlap errors are surfaced verbatim (they name the conflicting rows/ages), per the "clear inline error, not a generic failure" requirement.

### 22.4 Real-DB verification (all green)
New `test-e2e/test-master.e2e-real-db.spec.ts` (8 tests) against real Postgres, covering every §5 scenario: (1) numeric test with default + 2 non-overlapping specs + critical range persists and reloads intact; (2) patient matching a spec snapshots THAT spec's range (30-40, not the default); (3) patient matching no spec snapshots the default; (4) two overlapping specs in one save → 400 naming the conflict, nothing persisted; (5) options test snapshots `resultOptions`, ranges null; (6) text test snapshots only the type; (7) numeric test with no default and no matching spec → 400, order not created; plus TestSpecification fail-closed tenant scoping. Unit: new `test/reference-range.spec.ts` (11 tests) for the resolution tiers, inclusive bounds, partial-default handling, tier-based overlap, and patient-age derivation.

**Regression guard note:** §2 rule 4 is a deliberate behavior change — a numeric test with no range at all can no longer be ordered. To keep every prior suite valid without touching their assertions, the seed now defines default ranges, and the e2e test-creation payloads (orders/samples/dedicated/package-swap) that ORDER the tests they create gained `defaultRefLow/defaultRefHigh` in their setup POSTs. No prior assertion, price, sample, or billing expectation changed.

Full suite after this pass: **integration 38/38** (test-master 8 + package-swap 3 + concurrency 2 + samples 10 + orders 11 + dedicated 4) · **unit 72/72** · web unit 18/18 · typecheck ✓ · lint 0 ✓ · build (api + web) ✓ · `verify:real-db` end-to-end ✓. CI green on push.

## 23. Supabase Integration (auth + storage backend)

### 23.1 What was added and why
Supabase (`@supabase/supabase-js` v2, added to `apps/api`) is the auth + storage backend. The LIMS database **remains Prisma-managed PostgreSQL** — Supabase is itself Postgres-based, and the existing schema/migrations/tenant-scoping are untouched; Supabase is consumed **server-side** by the NestJS API only (the service-role key never reaches the browser).

- `apps/api/src/supabase/supabase.service.ts` — injectable service: lazy anon/admin clients (`createClient`, `persistSession: false`), `projectRef` accessor, `isConfigured()`, and `verifyToken(token)` (validates a Supabase access-token JWT via `auth.getUser` — the building block the auth stage's NestJS guards will use, mapping `user.id` into the user scoping that currently uses `SYSTEM_USER_ID`).
- `apps/api/src/supabase/supabase.module.ts` — `@Global()` module, exported for any future auth/storage/reports module.
- **Lazy construction is deliberate:** the app boots and the unit + real-DB suites run before the keys are populated in the Keys tab, so constructing the service never touches the network; only *using* a client without `SUPABASE_URL`/keys throws a clear configuration error.
- `apps/api/test/supabase.service.spec.ts` — 8 unit tests with `@supabase/supabase-js` mocked (config-gated errors, lazy singleton reuse, `verifyToken` success/error paths, project ref).

### 23.2 Required keys (add to the Freebuff Keys/API-keys tab; names match `apps/api/env.example`)
| Key | Where to find it |
| --- | --- |
| `SUPABASE_URL` | Supabase Dashboard → Project Settings → API → Project URL (`https://<project-ref>.supabase.co`) |
| `SUPABASE_ANON_KEY` | API → Project API keys → `anon` `public` (publishable, safe for the API server and eventually the web app) |
| `SUPABASE_SERVICE_ROLE_KEY` | API → Project API keys → `service_role` `secret` — **server-side only**, bypasses RLS; never expose to the browser |
| `SUPABASE_PROJECT_REF` | The short project reference from the URL (`https://<ref>.supabase.co`) |

Sandbox `.env` values are dev values; production keys go through `freebuff-deploy env set` when the app is deployed. Once the keys are in, `verifyToken` can be exercised end-to-end and the auth stage (NestJS guards + Supabase session flow) is a straight follow-on.

## 24. Stage 3 — Result Entry (build record)

### 24.1 Schema (migration `20260812000003_result_entry`, generated by diffing the committed migrations against the updated schema on live embedded Postgres — same pattern as Stage 2.5)
- `OrderTest.resultValue TEXT?` (interpreted per `snapshottedResultType`: numeric string / one of the snapshotted options / free text), `enteredBy TEXT?`, `enteredAt TIMESTAMP(3)?`.
- `OrderTest.snapshottedResultOptionsAbnormal TEXT[] @default([])` and `MasterTest.resultOptionsAbnormal TEXT[] @default([])` — the **abnormal-option classification** the spec's §3 flagged as missing. Stage 2.5's `resultOptions` stays a flat `String[]`; the classification is a **parallel array** (purely additive — the existing `snapshottedResultOptions` JSON and every prior assertion are untouched). `OrderTestStatus` already had `entered` since Stage 1 — no enum change needed.
- **Rollup decision (documented, not left ambiguous):** `Order.status` logic is **unchanged** — the spec's §1 said "no changes to the rollup logic itself (already correct from Stage 1)", and Stage 1's ladder already reflects `entered`: mixed pending/entered → `entered`; all entered (none verified) → `partially_verified` (the next rung; a new `partially_entered` enum value would contradict Stage 1's own §4 ladder). The auto-complete cascade therefore advances `billed → entered → partially_verified`, and the e2e asserts exactly that.

### 24.2 API
- `GET /api/orders/:id/results` — one call for the whole grid: order/patient header (age recomputed from DOB, display-only) + **grouped by Sample** (the physical tube), returning ONLY tests whose `Sample.status = 'collected'`. Each test row carries its snapshots: type, options + abnormal options, ref/critical thresholds, current value, status, enteredBy/At.
- `PUT /api/orders/:id/results` — batch `{ entries: [{ orderTestId, resultValue, expectedValue? }] }`. Per row:
  1. **Validation (whole-batch 400)** — row exists + belongs to this order/tenant; its sample is collected; `resultValue` valid against the row's OWN snapshots (`numeric` → parseable number, `options` → exact member of `snapshottedResultOptions`, `text` → any non-empty string). **Never a live MasterTest lookup.**
  2. **Concurrency-safe write** — conditional `updateMany` with a **compare-and-swap on `resultValue`** plus the status guard `NOT IN (verified, approved)`. `expectedValue` (optional) is the value the client last observed; omitted ⇒ null, the entry path. Under two simultaneous saves of the same pending row the loser's predicate is re-evaluated against the winner's committed row and fails → reported as **skipped** (never silently overwritten, never a crash — §4's exactly-one proof). The status guard stops a stale save from clobbering a row a later stage has verified. Legit edits send `expectedValue` = the current value and land; stale edits are skipped and the grid resyncs.
  3. Empty `resultValue` = "not yet entered": clears the row back to `pending` (never advances status — the text-empty decision).
  4. **Rollup cascade** — recomputes `Order.status` from ALL the order's OrderTest statuses via the existing Stage 1 `computeOrderStatus` helper (never a second implementation), written only when it changes.

### 24.3 Frontend (`/orders/:id/results`)
`ResultEntry.tsx`: sticky profile header (patient, age/sex, order status, **"n/total entered" progress bar**, Mark All Normal) + sticky column headers (Test Name / Result / Reference Range / Status). Grouped-by-sample cards. **Keyboard-first**: Enter moves to the next input, Arrow Up/Down navigate rows, Esc clears the focused input, text expands to a textarea on focus. Type-aware inputs: numeric (validated, flagged on blur), options (**typeahead combobox** filtered against the snapshots, Down+Enter selects, no free typing), text (expands). **Visual flagging on blur** (not per keystroke): normal / abnormal (amber bold + (H)/(L)) / **critical** (red cell + *"Critical value — please verify."* inline — display-only, no alerting, per scope) / invalid. Autosave on blur through the same validated endpoint; skipped saves show a resync banner. **Mark All Normal** fills unentered OPTIONS fields with the first non-abnormal option (tooltip says numeric/text are never auto-filled — no value is guessed). **Unit column deliberately omitted:** §3's header list mentions "Unit" but no unit field exists anywhere in the schema (§1's schema block is authoritative and doesn't define one) — flagged as a candidate small follow-up (MasterTest.unit + snapshot) rather than silently adding schema. **Text-expansion macros scoped out** per the spec's own allowance, flagged as deferred. Entry points: Order detail "Enter results" button (shown when ≥1 sample collected) + NavBar Operations → Result Entry.

Masters UI: options chips are now click-to-toggle **abnormal** (red ring + "abn" badge); `POST /api/masters/tests` accepts `resultOptionsAbnormal` (validated: options-type only, subset of `resultOptions` — caught at save time, never at Result Entry). Catalog table shows an "n abnormal" hint.

### 24.4 Real-DB verification (all green)
New `test-e2e/results.e2e-real-db.spec.ts` (12 tests) against real Postgres, covering every §6 done-criteria: collected-only grouped GET with full snapshot data; numeric entry + edit via CAS + stale-CAS skip + non-numeric 400; options valid/invalid (400) + abnormal snapshot; empty text never advances status + clear-to-pending; **uncollected sample save → 400**; **rollup cascade billed → entered → partially_verified**; **verified-row guard** (row forced to `verified` via the plain client → save skipped, value untouched); **§4 concurrency: two `Promise.all` saves of the same pending row with different values → exactly one lands, one reported skipped, exactly one row in the DB**; final GET summary reflects entered statuses. Unit: `test/result-value.spec.ts` (6) + `test/results.service.spec.ts` (9, mock-based) + web `lib/result-flags.spec.ts` (9, display-only flag computation).

Full suite after this pass: **integration 50/50** (results 12 + test-master 8 + package-swap 3 + concurrency 2 + samples 10 + orders 11 + dedicated 4) · **unit 95/95** · web unit 27/27 · typecheck ✓ · lint 0 ✓ · build (api + web) ✓ · `verify:real-db` end-to-end ✓. CI green on push. No prior suite was modified in this pass.
