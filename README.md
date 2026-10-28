# Ojaly API

NestJS 11 + MongoDB/Mongoose REST API for Ojaly. Multi-tenant, JWT access/refresh, transactional order and stock writes, Paystack webhooks, WhatsApp Cloud API, Resend, Cloudinary signing, reports, PDFs and Swagger.

- Local: `http://localhost:4100/api/v1`
- Swagger UI: `http://localhost:4100/docs`
- OpenAPI JSON: `http://localhost:4100/docs-json`

## Run

```bash
# from repo root
docker compose up -d mongo redis
cp .env.example .env
pnpm install
pnpm --filter @ojaly/backend seed
pnpm dev:backend
```

> MongoDB must run as a replica set for transactions. `docker-compose.yml` starts a single-node replica set on **27018** (existing local Mongo services often occupy 27017). Change `MONGODB_URI` if you use Atlas or another port.

### Environment

All variables are validated at boot (`src/config/env.validation.ts`). See [`.env.example`](.env.example).

Required:

- `MONGODB_URI`
- `JWT_ACCESS_SECRET` (32+ chars)
- `JWT_REFRESH_SECRET` (32+ chars)
- `APP_URL`, `API_URL`, `ADMIN_URL`, `PUBLIC_ROOT_DOMAIN`

Optional integrations are feature-gated and fail with clear messages when unconfigured:

- `CLOUDINARY_*` — signed uploads
- `RESEND_API_KEY`, `MAIL_FROM` — transactional email
- `PAYSTACK_*` — payment links/subscriptions/webhooks
- `WHATSAPP_*` — Cloud API
- `LLM_*` — optional fallback parser

## Modules

| Module | Responsibility |
| --- | --- |
| `auth` | registration, login, refresh rotation, verification, reset, profile |
| `businesses` / `memberships` | business profile, onboarding, staff, domains |
| `plans` | plans, entitlements, trials, subscriptions, coupons, counters |
| `products` / `stock` | catalog, variants, stock movement ledger, low-stock detection |
| `orders` / `sales` | order pipeline, transactional stock/debt writes, profit snapshots |
| `customers` / `debts` | customer ledger, part payments, reminders, overdue |
| `expenses` | categories, receipt images, recurrence materialisation |
| `reports` | dashboard ranges, insights, CSV/PDF exports |
| `payments` | Paystack links, checkout, signature-verified idempotent webhooks, renewals |
| `receipts` | sequential receipts, public pages/PDF, invoices |
| `whatsapp` | paste-chat parser, OTP linking, Cloud API bot, outbound templates |
| `summaries` | daily/weekly WhatsApp + email summary delivery |
| `storefront` / `builder` | public catalog, checkout, contact, templates, publishing |
| `notifications` | in-app alerts + debounced low-stock channels |
| `admin` | platform analytics, users, businesses, plans, coupons, payments, health, impersonation, CSV exports, support notes |
| `affiliates` | referral codes, attribution, commissions, holds, payout ledger |
| `uploads` / `mail` / `audit` | Cloudinary signatures, Resend templates, audit trail |
| `jobs` | trial enforcement, reminders, invoice status, recurring expenses, retries |

## Multi-tenancy

- Every tenant document has `businessId`.
- `TenantGuard` resolves the caller's membership on every request, verifies the business is not suspended, and attaches role/permissions to the request.
- Services always pass `businessId` into repository queries. Cross-tenant access returns `404` rather than leaking existence.
- Platform admin routes explicitly `@SkipTenant()` and require a platform role.
- The e2e suite includes a tenant-isolation test. Impersonated actions are tagged with `metadata.impersonatedBy` via an AsyncLocalStorage request context.

## Roles & permissions

Business roles: `owner`, `staff`. Owners bypass permission checks. Staff get an explicit permission list (`products:write`, `orders:write`, `reports:read`, etc.). See `src/common/constants/permissions.ts`.

Platform roles: `super_admin` (read/write) and `support` (read-only). Admin write endpoints are decorated `@PlatformRoles('super_admin')`.

## Transactions

`SalesService` and `OrdersService` use MongoDB sessions for stock, sale, debt and customer-total writes. Stock decrements use conditional atomic updates (`variants.quantity >= requested`) to prevent overselling. Receipts and notifications happen after commit, and the webhook layer is idempotent via unique provider event IDs.

## Tests

```bash
pnpm --filter @ojaly/backend test
pnpm --filter @ojaly/backend test:e2e
```

Unit tests cover money/profit allocation, debt statuses, stock ledger, opening stock, insufficient stock, and the WhatsApp/paste parser including LLM fallback.

E2E covers:

- registration, login, refresh rotation, duplicate emails, unauthenticated access
- tenant isolation, transactional order creation, stock reduction, sale generation
- Meta challenge verification, OTP linking, WhatsApp sale + `UNDO` + stock restoration
- Paystack signature verification, settlement, duplicate webhook idempotency
- referral attribution, 20% commission, hold release, payout request + admin payout
- support notes, CSV exports and audited impersonation

`mongodb-memory-server` uses a cached binary when available and a workspace download directory otherwise.

## Seed

```bash
pnpm --filter @ojaly/backend seed
```

- Ensures the three default plans exist (idempotent).
- Creates/updates the super admin from `SEED_SUPER_ADMIN_*`.
- Creates Tola Thrift demo data unless `SEED_DEMO=false`.

## Background jobs

Nest Schedule (timezone `Africa/Lagos`) runs summaries (every minute with claim locks), trial enforcement, debt reminders, invoice status refresh, recurring expenses and webhook retries. Redis is available in compose for a future BullMQ migration; the current scheduler is safe for a single instance and uses atomic claims where duplicates matter.

## Security notes

- Helmet, compression, CORS allowlist, request IDs.
- Validation whitelist strips unknown fields.
- Rate limiting: global 240/min, auth endpoints stricter.
- JWT access 15m, refresh rotation with hashed opaque tokens and revocation.
- Password hashes bcrypt (cost 12).
- Paystack and WhatsApp signatures are verified against raw request bodies.
- Signed Cloudinary uploads (no server relay, no secrets in the browser).
- The global exception filter logs stacks but never bodies.
- Audit records are written for sensitive actions.

See [WhatsApp setup](../../docs/WHATSAPP.md), [integrations](../../docs/INTEGRATIONS.md) and [deployment](../../docs/DEPLOYMENT.md).
