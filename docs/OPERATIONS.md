# Production operations and incident response

## 1. MVP production topology

The launch topology is deliberately small and explicit:

- Customer, staff POS, KDS, and admin Next.js applications deploy as separate Vercel projects behind TLS.
- One active containerized NestJS API service runs in the same US region as the data services. The platform must restart an unhealthy container automatically and retain the previous image for rollback.
- Managed PostgreSQL is authoritative for inventory, payments, orders, fulfillment, and audit history. Enable encrypted connections, daily backups, point-in-time recovery, connection pooling, and provider high availability.
- Managed Redis supplies shared rate-limit counters. The API falls back to per-instance limits during an outage and emits `security.rate_limit_redis_unavailable`.
- Stripe and Postmark remain external providers. Credentials exist only in the hosting secret manager.

The initial release keeps one active API instance because fulfillment notifications are in-process SSE. Every operational client re-fetches PostgreSQL every two seconds, so a notification loss affects latency rather than correctness. Before running multiple simultaneously active API replicas, add Redis-backed fulfillment-event fanout and prove it under the opening-night test.

Deploy migrations as a separate pre-release job. They must finish before application traffic moves to the new image. Roll back application code independently; never roll back a migration by deleting production data.

## 2. Health and monitoring

- `/api/v1/health/live`: process liveness only.
- `/api/v1/health/ready`: PostgreSQL and Redis readiness. Route traffic only when it returns 200.
- `/api/v1/health/operations`: protected with `OBSERVABILITY_TOKEN`; returns only aggregate operational counters, never tenant or payment credentials.
- `ERROR_ALERT_WEBHOOK_URL` is optional and vendor-neutral. When configured, unexpected API failures send a short alert containing the environment, request id, method, path, error class, stack fingerprint, and code frames. Exception messages, request/query data, credentials, and customer/payment data are never forwarded.
- Root crashes in the customer site, Admin, Attend Master, Staff POS, and KDS post the same redacted metadata to the rate-limited `/api/v1/health/client-errors` collector. Each app shows a recovery screen while alert delivery remains best-effort and non-blocking.

Minimum alerts:

| Signal | Warning | Page |
| --- | --- | --- |
| Readiness | 2 failures in 2 minutes | unavailable for 5 minutes |
| `failedPayments15m` | 3 | 10 or a sustained increase |
| `stalePayments` | any for 10 minutes | any for 20 minutes |
| `staleRefunds` | any | any for 20 minutes |
| `managerReviewTabs` | any during service | increase across two checks |
| `expiredHoldBacklog` | any for two hold sweeps | increasing for 5 minutes |
| `attentionEvents15m` | any | 5 or more |
| API latency | p95 over 1 second for 5 minutes | p95 over 2.5 seconds for 10 minutes |
| HTTP errors | 5xx over 1% for 5 minutes | over 5% for 5 minutes |

Dashboard panels must split payment/refund errors, seat-hold conflicts, restaurant fallback settlements, and general HTTP failures. Alert payloads include request IDs and safe internal record IDs only.

## 3. Payment-processor outage

1. Incident commander acknowledges the alert and records start time, affected channel, and request IDs.
2. Confirm Stripe status independently and check readiness plus `failedPayments15m`, `stalePayments`, `staleRefunds`, and `managerReviewTabs`.
3. Do not mark a payment successful, issue tickets, or retry ambiguous money movement manually. The provider and local idempotency keys remain authoritative.
4. Keep cash box-office sales available if seat inventory and the API are healthy. Staff explain that online/card checkout is temporarily unavailable; never copy card details into notes or another system.
5. When Stripe recovers, run/observe the existing refund reconciliation and restaurant settlement paths. Work every `MANAGER_REVIEW` item from the management screen.
6. Reconcile Stripe payment/refund IDs against local Payment and Refund rows. Resolve every ambiguous item before closing the incident.
7. Post an incident summary with duration, affected attempts, customer remediation, and a prevention owner. Never paste tokens, card data, or webhook payload secrets into the report.

## 4. Seat-inventory anomaly or suspected double sale

1. Stop new sales for the affected showtime through the audited admin showtime control. Do not edit inventory directly in PostgreSQL.
2. Capture the showtime ID, affected seat labels, order IDs, request IDs, and timestamps.
3. Compare active Ticket rows, unreleased SeatHold rows, and ShowtimeSeat inventory. A seat may have at most one active ticket; expired holds must be released by the sweep.
4. If money moved without a valid ticket, use the established idempotent compensation/refund workflow. If two customers are affected, escalate to the GM for reseating/comp policy while preserving both records.
5. Restore sales only after the invariant query is clean and a second operator confirms it.
6. Run the opening-night concurrency test against staging before deploying a corrective release.

## 5. Secret rotation and release gate

Before production launch, replace every placeholder with independently generated values in the hosting secret manager. Required secrets include database and Redis credentials, access/refresh JWT keys, QR credential key, observability token, Stripe secret/webhook keys, and Postmark token.

Stripe defaults to `STRIPE_MODE=test`. Enabling real charges is a deliberate release action: set `STRIPE_MODE=live`, `STRIPE_SECRET_KEY=sk_live_…`, and `STRIPE_PUBLISHABLE_KEY=pk_live_…` together in the production API and customer-web environments, with the live endpoint's `STRIPE_WEBHOOK_SECRET`. Boot validation rejects live mode outside `NODE_ENV=production` and rejects mixed test/live key pairs. Verify Connect onboarding, one low-value charge, webhook receipt, and refund in live mode before opening sales.

- Never reuse access, refresh, QR, or observability secrets.
- Rotate Stripe/Postmark credentials in their provider consoles, deploy the new value, verify, then revoke the old value.
- Rotating JWT keys invalidates sessions; announce the maintenance effect and verify staff can sign in again.
- Rotating the QR key invalidates outstanding ticket credentials and therefore requires a planned reissue/multi-key migration—not an uncoordinated environment change.
- Review secret access quarterly and immediately after personnel or vendor-access changes.

Release requires green migrations, typecheck/lint/unit, real-Postgres integration, dependency audit, critical Playwright journeys, a staging opening-night load report, verified backups/restore, named incident commander/on-call contacts, and a rollback image.
