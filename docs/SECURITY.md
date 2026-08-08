# Security

Status: Draft v1
Related: PAYMENT_FLOW.md, DATA_MODEL.md, ARCHITECTURE.md

## 1. Authentication

- **Customers**: email/password (argon2id hashing, no home-grown crypto) or OAuth (Google, Apple) via a vetted library (Auth.js/NextAuth on `customer-web`, backed by our own `CustomerAuthAccount` table so account data lives in our DB, not solely with the IdP). Sessions are short-lived JWT access tokens + rotating refresh tokens, HttpOnly/Secure/SameSite cookies. The customer web app sends customer API traffic through its fixed-upstream, same-origin `/api/v1` proxy so browsers store and return those cookies for the customer site rather than treating them as third-party Railway cookies. The proxy does not expose tokens to JavaScript, accept arbitrary upstreams, or carry staff bearer credentials. Guest checkout requires no account — a guest `Customer` record is created from checkout contact info, and the live-tab/receipt links use a signed, time-limited token instead of a login.
- **Staff**: separate credential system (`StaffAuthAccount`), same hashing standard, because staff accounts carry operational/financial permissions and should not share an identity system or session model with customer accounts. TOTP-based MFA (`otplib` or equivalent, standard RFC 6238) is **required** for `OWNER`, `GENERAL_MANAGER`, and `ACCOUNTING` roles, and available optionally for others. This satisfies "require MFA for sensitive administrative accounts" without inventing custom cryptography — TOTP is a well-understood standard.
- No password or token is ever logged, including in error logs.

## 2. Authorization — enforced server-side, always

Every state-changing API endpoint declares the permission(s) required; a NestJS guard checks the authenticated actor's `Role → Permission` mappings against the requirement before the handler runs, and endpoints additionally check resource-level scope (e.g., a server can only act on tabs at their assigned location, not another). **UI hiding of buttons is a UX convenience only** — the same permission check the API enforces is what actually protects the action, matching the spec's explicit instruction not to rely on hiding buttons.

### 2.1 Role → representative permission matrix (illustrative, full matrix maintained in `/packages/auth`)

| Action | Server | Bartender | Kitchen | Box Office | Rest. Mgr | Cinema Mgr | GM/Owner | Accounting |
|---|---|---|---|---|---|---|---|---|
| Create/send restaurant order | ✓ | ✓ | – | – | ✓ | – | ✓ | – |
| Update prep status (KDS) | – | – | ✓ | – | ✓ | – | ✓ | – |
| View payment method display (brand/last4) | ✓ | ✓ | – | ✓ | ✓ | – | ✓ | ✓ |
| View/charge raw payment data | – | – | – | – | – | – | – | – |
| Void/comp restaurant item | – | – | – | – | ✓ | – | ✓ | – |
| Sell/hold/block seats | – | – | – | ✓ | – | ✓ | ✓ | – |
| Change ticket prices | – | – | – | – | – | ✓ | ✓ | – |
| Refund ticket or tab payment | – | – | – | limited¹ | limited¹ | ✓ | ✓ | ✓ |
| Edit employee permissions | – | – | – | – | – | – | ✓ | – |
| View financial reports | – | – | – | – | partial | partial | ✓ | ✓ |
| View audit log | – | – | – | – | partial | partial | ✓ | ✓ |

¹ MVP refund policy is full refunds only (100%), confirmed by the product owner — there is no partial-refund workflow and no dollar-threshold escalation tier for MVP. Any role holding `payment.refund` can issue a full refund directly. Partial refunds and escalation tiers remain schema-compatible (PAYMENT_FLOW.md §7) for a later phase but are not built now.

### 2.2 Tenant isolation is tested as rigorously as seat concurrency

Every permission check above is necessary but not sufficient on its own — a valid, correctly-scoped token from Organization A's own employee must still be rejected if it targets Organization B's resources, even with a real, guessed, or otherwise obtained UUID belonging to B. **UUIDs are not an authorization boundary.** Every query must be scoped by the actor's own `organizationId`/`locationId`, not merely by the requested resource's own primary key — this is a standing rule from Milestone 0 onward, not something deferred until multiple real tenants exist.

Confirmed (2026-07-25): this gets a mandatory cross-tenant test matrix, not incidental coverage. As each milestone introduces new resource types, its own test suite includes at least a basic tenant-scoping check for them (Organization A actor, Organization B resource, expect 403/404) rather than waiting until the end. IMPLEMENTATION_PLAN.md Milestone 10 requires the comprehensive version once every resource type exists: a second seeded Organization with its own staff, customers, showtimes, and tabs, and a test asserting every one of Organization A's roles gets 403/404 attempting to read or act on Organization B's customers, orders, tabs, employees, showtimes, reports, refunds, payment method references, and audit records. For a multi-tenant SaaS platform, tenant data leakage is treated with the same severity as double-selling a seat.

No role, including `OWNER`, can retrieve a raw PAN/CVV through this application — that data never enters our system at all (§4), so this isn't a permission we grant or withhold, it's structurally impossible via tokenization.

## 3. What "minimizing PCI scope" means here, precisely

Two different channels, two different (both reduced) scope stories — worth stating precisely rather than implying one covers both:

- **Online/self-service entry** (ticket checkout, customer live-tab pay): card entry via Stripe Elements/Payment Element means cardholder data is entered directly into a Stripe-hosted iframe and never touches our servers, which is what qualifies us to self-assess against **SAQ A** (the lightest PCI DSS self-assessment tier).
- **In-person entry** (check-drop split-tender, box-office card sales — PAYMENT_FLOW.md §1.2): card data is captured by a PCI-validated Stripe Terminal reader using point-to-point encryption, also never reaching our servers or the staff device's own software in readable form — but this is a different assessment category (SAQ B-IP-equivalent, not SAQ A), since it involves physical card-present hardware under our operational control rather than a customer's own browser.

Both are a meaningful, real reduction in scope and liability. **Neither is, by itself, "PCI compliance."** Compliance requires completing the applicable SAQ(s), meeting their remaining requirements (secure development practices, access control, vulnerability management, etc.), and is ultimately a determination made by the business (often with a QSA/acquirer), not a status this codebase can self-certify. This document flags the requirement; it does not claim it's satisfied.

## 4. What we store vs. never store

**Never stored, anywhere, under any circumstance:** full PAN, CVV/CVC, magnetic stripe/chip data, PIN.

**Stored:** Stripe `PaymentMethod` id, `Customer` id, card brand, last4, expiry month/year (all explicitly non-sensitive per PCI DSS when not accompanied by full PAN) — sourced from Stripe's API responses, never derived from raw card data we've seen ourselves, because we never see it.

## 5. Webhook security

Every inbound Stripe webhook is verified against the `Stripe-Signature` header using the webhook signing secret (`STRIPE_WEBHOOK_SECRET`, environment-only) before any parsing of the payload occurs; unverified requests are rejected with no further processing (closes the "anyone can POST fake payment success" attack). Combined with `ProcessedWebhookEvent.providerEventId` uniqueness (PAYMENT_FLOW.md §5), this also closes replay: a captured-and-resent valid webhook payload is rejected as a duplicate after first processing, and a payload replayed outside Stripe's signature validity window is rejected by signature timestamp tolerance checking (Stripe SDK default behavior, not something we weaken).

## 6. Secrets management

All credentials (Stripe secret key, webhook signing secret, DB connection string, JWT signing keys, email/SMS provider keys) live in environment variables, loaded and validated (required/shape-checked) at process boot via a schema in `/packages/config` — the app fails to start with a clear error if a required secret is missing, rather than running in a degraded/insecure state. `.env` files are gitignored; `.env.example` documents required keys with placeholder values only. No secret is ever sent to a frontend bundle — publishable/public keys (e.g., Stripe publishable key) are the only processor-related values that reach the client, by design (that's what "publishable" means). Production secrets are managed via the hosting platform's secret manager (exact choice pending infra decision, see OPEN_QUESTIONS.md), never committed, never pasted into chat/tickets in plaintext.

## 7. Data protection

- HTTPS enforced in all non-local environments (HSTS enabled).
- PII at rest (customer email/phone/name) relies on Postgres access controls and encrypted storage at the infrastructure layer (managed Postgres with encryption at rest); a targeted set of especially sensitive fields (e.g., any future stored government ID for age verification, if ever added) would use application-level encryption — not needed for the MVP field set, flagged here so it isn't forgotten if scope grows.
- Backups follow the same encryption/access standards as primary storage; backup access is itself an audited, permissioned action.

## 8. Rate limiting

Global per-IP rate limiting at the API gateway layer, with tighter, purpose-specific limits on: login/auth endpoints (brute-force protection), checkout/payment endpoints (card-testing abuse protection, PAYMENT_FLOW.md §9), and ticket-scan endpoints (prevents scan-spamming as a denial-of-service against the door). Implemented via Redis-backed counters (works correctly across multiple API instances).

Anonymous customer checkout is application-limited by source IP only; holder keys and request IDs are client-generated and therefore are not trusted as stable abuse-prevention identities. Authenticated box-office checkout additionally limits by employee identity. See PAYMENT_FLOW.md §9 for the explicit rationale and monitoring boundary.

The ticket-scan endpoint enforces a fixed-window limit of 60 attempts per minute for each authenticated employee and source IP. The production path uses Redis so limits are shared by every API instance; tests use an isolated in-memory counter.

## 9. Audit logging

Every sensitive action listed in the product spec (refund, seat move/block, item void, comp, permission change, price change, showtime cancellation, cash adjustment, manual tab closure, and more) writes an `AuditEvent` in the same transaction as the action itself — audit logging is not a best-effort side effect fired after the fact, it's part of the atomic operation, so an audit record can never be missing for an action that actually took effect. Audit records are immutable (no update/delete API), queryable by actor/entity/date range for GM/Owner/Accounting roles, and explicitly exclude payment credentials (§4) while including safe references (payment id, last4/brand) where useful for investigation.

## 10. Input validation

All API request bodies validated against explicit schemas (zod, shared between API and frontends via `/packages/shared`) before touching business logic — rejects malformed/unexpected fields rather than passing them through. This is standard practice and also directly relevant here because financial/reservation endpoints are the highest-value target for malformed-input attacks.

## 11. Explicitly not solved by this document

Alcohol service compliance (age verification procedures, service cutoffs, local licensing rules), sales tax correctness for jurisdictions with complex rules, and specific legal retention requirements for financial records are **operator/business/legal responsibilities**, not engineering assumptions this system invents. Where the system needs a policy (e.g., "how many minutes after showtime does auto-settlement fire," "default tip if customer never responds"), it exposes a configuration point rather than hardcoding an assumption presented as fact. See OPEN_QUESTIONS.md.
