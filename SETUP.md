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

**Current decision (review pass, §15.1):** `MasterTestPackage.packagePrice` is the authoritative billing price. A package still produces one `OrderTest` row per constituent test (Stage 2 Result Entry needs a row per test), but `packagePrice` is **distributed across those rows proportionally to each test's standalone price** (`distributePackagePrice` in `apps/api/src/orders/package-pricing.util.ts`), with the 2dp rounding residual applied to the largest share so the distributed values **sum exactly to `packagePrice`**. The order subtotal/total therefore always reflect `packagePrice`, never the sum of standalone prices. E.g. tests priced 700 + 500 (sum 1200) in a package priced 900 → two OrderTest rows at 525 + 375. A test ordered both standalone AND inside a package appears as two line items (the package is a separately priced unit).

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
`npm run typecheck` ✓ · `npm run lint` (0 errors/warnings) ✓ · `npm run build` ✓ · `npm test` — 8 suites / **51 unit tests** covering: patientUid generation & collision safety, duplicate detection, package-from-selection creation, package-price distribution, discount bounds + subtotal/total cross-check, payment split-sum validation, invoice status derivation, order rollup, and fail-closed tenant scoping ✓ · `npm run verify:real-db` — **8/8 integration tests against real PostgreSQL** (see §15) ✓ · API boots clean (`Thulir API listening on 0.0.0.0:3000`) with all routes mapped ✓

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

## 16. Freebuff preview commands (documented — CLI unavailable in this sandbox)
The `freebuff-preview` CLI is not present in this workspace, so the commands below could not be registered via the tooling. They are exactly what the platform would register once the CLI is available (the root scripts already exist in `package.json`):

```bash
freebuff-preview set-install "npm install"
freebuff-preview set "npm run dev" 5173      # runs API (:3000) + Web (:5173) via concurrently; both bind 0.0.0.0
freebuff-preview set-build "npm run build"
```

Note: the API needs a reachable PostgreSQL (`DATABASE_URL`) — in hosted previews set it via the Keys/API-keys UI (env name `DATABASE_URL`), or run `docker compose up -d db` locally. The web UI renders regardless; API-backed data requires the DB.
