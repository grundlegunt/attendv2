# Attend — Admin App Structure & Domain Completeness

Status: Implemented and reconciled August 24, 2026.

## Current structure

`apps/admin` is a routed operations application with a persistent left navigation. The dashboard remains the landing page; operational domains live on focused routes instead of one stacked settings screen.

| Route | Responsibility |
| --- | --- |
| `/` | Operational dashboard and daily schedule |
| `/scheduling` | Film library, calendar scheduling, saved plans, showtime editing, seat inventory, sale status, pricing groups, presentation, and film details |
| `/film-series` | Create, edit, archive, and restore managed film series |
| `/cinema-setup` | Auditoriums, seat maps, and cinema configuration |
| `/branding` | Customer-site branding and published content controls |
| `/location` | Location identity, timezone, operational buffers, public links, and operating settings |
| `/menu` | Categories, stations, items, modifiers, availability, and published menu presentation |
| `/private-events` | Persisted private-event inquiry queue, status management, filtering, and CSV export |
| `/attention` | Consolidated actionable operational exceptions |
| `/refunds` | Ticket and restaurant refund workflows and history |
| `/labor` | Hours reporting, exports, and manager shift corrections |
| `/reports` | Revenue, film settlement, ticket-fee, promotion, and related financial reporting |
| `/expenses` | Expense entry and reporting |
| `/gift-cards` | Gift-card issuance, balances, and ledger activity |
| `/promotions` | Promotion creation, editing, status, limits, and redemption reporting |
| `/taxes` | Ticket pricing groups, admission types, taxes, and service-charge configuration |
| `/users` | Employees, credentials, roles, permissions, and access management |
| `/audit-log` | Filtered, paginated audit history with state details |
| `/search` | Location-scoped search across orders, customers, tickets, and gift cards |

Staff POS and KDS remain separate applications. Admin links to their configured deployments when the signed-in employee has access; their operational workflows should not be duplicated inside Admin.

## Architecture decisions

- Route visibility and page actions are permission-gated. Hiding a navigation item is not a substitute for enforcing the same permission in the API.
- Scheduling and auditorium setup are distinct domains: scheduling manages films and showtimes, while cinema setup manages the rooms and seats those showtimes use.
- Shared components may serve more than one route, but route ownership follows the operator's task rather than the historical source-file boundary.
- The API remains the source of truth for location scope, idempotency, concurrency, audit records, and financial calculations. Pages should not recreate those rules client-side.
- Customer-site branding, content, and merchandise links are published operator settings; transactional merchandise remains outside the current product scope.

## Guardrails

- Preserve the distinction between financial-report permissions and general-report permissions.
- Keep every mutation location-scoped, idempotent where a retry could duplicate work, and serialized in the UI where concurrent actions would conflict.
- Use the cinema timezone for schedules, reports, exports, shifts, and operator-visible timestamps.
- Keep tax rules, ticket pricing, service charges, promotions, and historical transaction calculations separate; editing a current rule must not rewrite historical sales.
- Deactivation or archival is preferred when records are referenced by historical activity.
- Keep sensitive customer, employee, payment, and audit data out of client logs and error-reporting payloads.
- Extend an existing domain route and API contract before creating another catch-all management screen.

## Remaining product decisions

The current routed structure is not itself a backlog. Remaining Admin work should come from a reproducible operator need or an explicit product decision. Examples already tracked in `POST_MVP_BACKLOG.md` include whether the selected-showtime editor should become a compact inspector, where an in-person tipping surface is still needed, and whether abandoned checks should support a configurable disclosed fallback gratuity.
