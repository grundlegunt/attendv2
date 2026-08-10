# Attend — Admin App Structure & Domain Completeness

## Problem

`apps/admin` is currently one single page (`apps/admin/app/page.tsx`) with everything stacked vertically: auditorium/movie setup, the scheduling calendar, and three dense catch-all components — `menu-manager.tsx`, `management-dashboard.tsx`, `management-controls.tsx` — each cramming multiple unrelated business domains into one file of single-line JSX. For example, `management-dashboard.tsx` alone contains Finance/Revenue, Labor, Location settings, Promotions, and the Audit log; `management-controls.tsx` contains Tax Rules, Service Charges, Users, Permissions, and Refunds. There's no reason movie scheduling, tax configuration, and the audit log should all live on the same scroll.

`docs/IMPLEMENTATION_PLAN.md` already anticipated "full config screens for taxes/service charges/promotions/users/permissions" — the current single-form-per-domain implementation is intentionally minimal from an early milestone, not a finished feature set.

## Scope note

**Scheduling and the auditorium/theater-layout builder are explicitly out of scope for this doc.** That work is already in progress separately — see `docs/PROGRAMMING_AND_SCHEDULING.md`, `docs/ADVANCED_THEATER_LAYOUT_BUILDER.md`, and the in-progress `agent/admin-calendar-scheduling` branch. Once that work has its own page, this doc's page-split proposal below should slot it in as its own route, but don't re-scope or touch it as part of this task.

> Status note: this document captured an earlier audit. The routed page split and the operational gaps listed below—including location controls, refund state/history, tax and service-charge updates, shift corrections, promotion controls/reporting, employee credential and role management, audit filters/pagination/diffs, and full menu setup—have since shipped. Treat the findings as implementation history, not the current backlog.

## Proposed page split

Move from one page to separate routed pages under a persistent nav (top nav or left rail — match whatever the scheduling calendar work lands on, don't introduce a second, inconsistent nav pattern). Suggested breakdown, one page per domain rather than per current file (the current files don't reflect natural domain boundaries):

- **Scheduling** — the existing calendar (already being built separately, see Scope note above).
- **Menu** — categories, kitchen stations, items, modifier groups, modifiers, 86'ing (currently `menu-manager.tsx`).
- **Reports & Finance** — revenue report, by movie / by showtime (currently the FINANCE section of `management-dashboard.tsx`).
- **Labor** — hours report, CSV export, shift adjustment (currently the LABOR section of `management-dashboard.tsx`).
- **Location** — operating settings (currently the LOCATION section of `management-dashboard.tsx`).
- **Promotions** — discount codes (currently the PROMOTIONS section of `management-dashboard.tsx`).
- **Tax & Service Charges** — currently the TAX RULES / SERVICE CHARGES sections of `management-controls.tsx`.
- **Users & Permissions** — currently the USERS / PERMISSIONS sections of `management-controls.tsx`.
- **Refunds** — currently the REFUNDS section of `management-controls.tsx`.
- **Audit Log** — currently the AUDIT section of `management-dashboard.tsx`.

This is a page-routing and component-decomposition change, not a rewrite — the underlying `apiFetch` calls, permission checks (`employee.permissions`), and most JSX can move largely as-is into their new page. Split `menu-manager.tsx`/`management-dashboard.tsx`/`management-controls.tsx` along domain lines as part of this move rather than keeping the current file boundaries under new routes.

## Guardrails

- Every one of the domains below already has a real, permission-gated backend behind it. Don't rebuild any API endpoint that already exists — extend it (add a PATCH, add a query param) rather than replacing it.
- Preserve existing permission gating exactly (`Permission.ReportsViewFinancial` vs `Permission.ReportsView`, `canMenuConfig`, `canPermissions`, `canAudit`, etc.) when moving code to new pages — don't accidentally loosen or drop a check during the split.
- Where a finding below says "no UI for an existing endpoint," wiring the UI to the existing endpoint is the whole task — no new backend work needed.
- Where a finding says something is missing at the schema/API level (noted explicitly below), that's a bigger task and should be scoped/confirmed before starting, not silently added as a drive-by.

## Domain-by-domain findings

Each finding below was verified directly against the current code (`main` branch), not assumed from the UI alone.

### Finance / Revenue Reporting

Well-built relative to spec — `docs/PRODUCT_SPEC.md`'s five required reporting items are mostly present: `GET /reports/revenue?from=&to=` (`apps/api/src/reporting/reporting.controller.ts`) returns gross/refunded/net, ticket vs. F&B split, and breakdowns by movie and by showtime, all rendered with a real date-range picker in the admin UI.

- **Gap:** the backend already computes `averageFnbSpendPerOrderCents` and `averageFnbSpendPerSeatCents` (`reporting.service.ts`) — the fifth spec item — and the admin UI's `RevenueReport` type even declares both fields, but nothing renders them. Pure frontend fix.
- **Gap:** labor has a CSV export (`GET /reports/labor.csv`); revenue has no equivalent export endpoint or button.

### Refunds

- **Full refunds only.** There is no partial-refund amount field anywhere in the request schema or service (`box-office.service.ts`'s `refundOrder` always refunds the full `cashPaid`/`cardPaid` total). If partial refunds are wanted, that's a real feature addition (schema + service + UI), not a UI gap — confirm scope before starting.
- **The refund "workbench" is a to-do list, not a history view.** `GET /management/refunds` only returns currently-refundable orders/tabs; once refunded, an order disappears from the list entirely. There's no way to look up "what did we refund last week."
- **Gap — failed/ambiguous refund state isn't surfaced.** The backend correctly leaves a restaurant tab in `MANAGER_REVIEW` when a provider call fails or is ambiguous, and correctly keeps it in the refundable list for retry. But the admin frontend's `Refunds` type never carries the tab's `status` or its `payments`/`refunds`, so a tab stuck in manager-review renders identically to a normal, untouched one — there's no visual difference between "never refunded" and "refund failed, needs attention." Same problem on the ticket side: a failed card refund only shows a transient error banner, never a persisted state on the row. This is worth fixing before splitting the page — it's a real staff-facing correctness gap, not cosmetic.

### Tax Rules

- **Create-only.** `POST /management/settings/tax-rules` is the only endpoint — no edit, no deactivate. `TaxRule.active` exists as a schema field but nothing ever sets it to `false`.
- **Scope clarification, not a bug:** "Tax Rules" today only covers restaurant/F&B tax. Ticket sales tax is a completely separate mechanism — a single flat `Location.ticketTaxRateBasisPoints` field, shown read-only in the Location section with no dedicated edit control. When this becomes its own page, make sure it's clear to the operator that F&B tax rules and ticket tax are two different systems, not one.
- Multiple applicable tax rules stack additively by category (`ALL`/`FOOD`/`ALCOHOL`/`NA_BEVERAGE`) — no precedence/exclusivity logic exists if that's ever needed.

### Service Charges

- Same create-only gap as Tax Rules — `ServiceChargeRule.active`/`autoApply` exist in the schema but are unreachable after creation.
- **Always applied, never staff-waivable.** Settlement pulls every `active && autoApply` rule unconditionally; the POS only displays the computed charge as a read-only line, with no "waive" control anywhere in `apps/staff-pos`. If comping/waiving a service charge is wanted, that's new functionality, not a UI gap.

### Labor

- The hours report and its CSV export are both real and already correct — no gap there.
- **Not a gap, by design:** clock-in/out lives in `apps/staff-pos`, not the admin app — that's correct and shouldn't move.
- **Gap — a real endpoint has no UI.** `PATCH /shifts/:shiftId` already lets a manager adjust a shift (clock-in/out correction), gated by `Permission.EmployeeEdit`, but the admin app has zero controls for it — shifts are view-only today even though the backend fully supports editing them.

### Location

- The admin UI exposes exactly two things: a `timeClockEnabled` checkbox and a read-only tax-rate display.
- **Gap — most of the `Location` model has no admin UI at all**, and `PATCH /management/settings/location`'s schema is `.strict()`, meaning it currently rejects any of these if the frontend tried to send them: `name`, `address`, `timezone`, `currency`, `cleaningBufferMinutes` (default 15), `preShowBufferMinutes` (30), `checkDropMinutesBeforeEnd` (30), `autoSettleGraceMinutes` (5), `autoSettleTipBasisPoints` (0). These are real operational settings (turnover buffers directly drive the scheduling conflict rules in `docs/DATA_MODEL.md`) with no way for an operator to change them without a direct database edit. Extending the update schema and adding form fields for these is real, valuable work — not cosmetic.

### Promotions

- **Backend supports more than the UI exposes.** The schema/API already support `FIXED_AMOUNT`, `PERCENTAGE`, and `COMP` promotion types plus a `startsAt`/`endsAt` expiration window — but the admin form hardcodes `type: "FIXED_AMOUNT"` and has no fields for percentage, type selection, or dates.
- **Gap at the schema level, not just UI:** there is no usage-limit or minimum-purchase field anywhere in the `Promotion` model. If that's wanted, it needs a migration, not just a form field.
- **Create-only** — no way to deactivate or delete a promotion from the admin app once created (the "Active/Inactive" label in the list is read-only, no toggle).
- **No redemption reporting** — `TicketOrder.promotionId` links orders to the promotion that was used, but nothing in `ReportingService` aggregates by promotion, so there's no "how many times was CODE used" anywhere.
- Promotions currently only apply to ticket-order checkout — there's no promotion application path for restaurant/F&B tabs.

### Users

- **Gap — a real endpoint has no UI.** `updateEmployee` already accepts `roleIds` server-side, but the admin app's employee edit action only ever sends `{ active: !target.active }` — there's no form control to actually change an existing employee's role. Wiring the existing form up to also submit `roleIds` is the fix, no backend change needed.
- **No delete, only deactivate** — there's no delete endpoint. An `Employee.deletedAt` column exists in the schema but is never written anywhere; if hard-delete is ever wanted, that column is already there waiting for it.
- **No password/PIN reset path anywhere** — credentials are only set at creation time. If an employee needs a reset, there is currently no admin flow for it at all (this is a real operational gap for a POS staff system, worth prioritizing).
- Every employee belongs to exactly one location today (`Employee.locationId` is a single scalar FK). The `EmployeeRole` join table is already keyed by `(employeeId, roleId, locationId)` with a comment anticipating multi-location role assignment later, but nothing in the current create/update flow uses that — single-location is the real current behavior, not a UI limitation.

### Permissions

- 24 permissions exist in `Permission` (`packages/auth/src/permissions.ts`), rendered today as one flat, ungrouped list of checkboxes per role. That's already a long unstructured scroll and will only get worse.
- The enum is informally grouped by comment headers in the source (Employee/RBAC, Audit, Seating/ticketing, Restaurant/POS, Payments, Reporting) but there's no category data anywhere the API or database can hand to the frontend — grouping the UI sensibly means either adding a category column to the `Permission` model or hardcoding a frontend mapping that mirrors those comment groups (the latter is simpler and fine for now, just keep it in sync manually).
- **Only the 12 seeded roles can be edited — there's no way to create a new custom role.** No `createRole` endpoint exists anywhere. If custom roles are wanted, that's new backend work, not a missing form.

### Audit Log

- The admin UI exposes only a free-text substring filter on `action`. The API already supports `entityType`, `actorId`, `from`, and `to` — none of which the UI sends, even though the surrounding dashboard component already has `from`/`to` date state wired up for the other reports sitting right next to the audit panel.
- **No pagination** — a hard cap of 200 rows per query, no cursor/offset. A range with more than 200 audit events is simply not fully viewable today.
- **`beforeState`/`afterState` are already in the API response and are dropped by the UI.** The audit controller returns the full row including both JSON diff columns; the frontend only renders the one-line summary (action/entity/time) with no click-to-expand for what actually changed.
- Worth citing directly: the audit controller's own docstring says its filtering is deliberately thin for an early milestone, with fuller filtering/UX explicitly deferred — this isn't an accidental gap, it's a known placeholder that was never followed up on.

### Menu Management

- **The backend is essentially spec-complete** and noticeably ahead of the UI: full endpoints exist for categories, kitchen stations, items, modifier groups (with `selectionType`/`required`/`min`/`maxSelections`), and modifiers (with price deltas), and `updateMenuItem` already accepts edits to name, description, price, active, `is86d`, `sortOrder`, and kitchen station.
- **The UI only uses a fraction of this.** `menu-manager.tsx` can create a flat item (hardcoding `sortOrder: 0`) and toggle 86'd — that's it. There is no UI to create a category, a kitchen station, a modifier group, or a modifier, despite all of those endpoints already existing and working. There's no edit UI for price/name/description/station after creation, and no reordering control.
- **Real, immediate usability problem:** since there's no way to create the first category from the UI, a freshly-onboarded location's menu manager is unusable until someone manually seeds a category through the API or seed script — an operator can't self-serve their own menu setup today.
- The frontend's `Menu` type doesn't even declare a `modifierGroups` field, so modifier data the API already returns is silently discarded before it ever reaches the component.

## Suggested priority

If this needs to be tackled incrementally rather than all at once, the items above that are real user-facing correctness/usability problems (not just "thinner than ideal") are: the refund status gap (staff can't tell a failed refund from an untouched one), the missing role-edit UI (a working endpoint sitting unused), the missing password/PIN reset path, and menu management's category chicken-and-egg problem (new locations can't self-serve). Everything else is genuine but lower urgency scope-expansion.
