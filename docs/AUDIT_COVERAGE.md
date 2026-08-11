# Sensitive-action audit coverage

Milestone 11 reviewed the product/security example list against the implemented write paths. Audit rows are tenant scoped, immutable through the API, and written in the same database transaction as the sensitive state change unless the event describes an external-provider failure that occurred outside a database transaction.

| Spec action | Implemented audit coverage |
| --- | --- |
| Ticket refund/exchange/reprint | `ticket_order.refunded`, `ticket.exchanged`, `ticket.reprinted`, plus compensation attention/success events |
| Seat sale/block and scheduling changes | `ticket_order.box_office_sold`, seat-block events, `showtime.created`, `showtime.updated` |
| Restaurant item/order void, transfer, refire, fulfillment | Restaurant domain transition events, `restaurant_order.sent`, and fulfillment transition audit rows |
| Restaurant settlement/refund/manual closure | check-drop, tip, payment-failed, closed, refund, and attention-required events |
| Cash adjustment/drawer control | drawer opened/closed and cash-movement events |
| Employee shift override | `shift.manager_adjusted` with before/after state |
| Price/tax/service/promotion changes | menu-category, kitchen-station, menu-item, modifier, tax-rule, service-charge-rule, promotion, and location-setting events |
| User/role/permission changes | employee create/access updates and `role.permissions_updated` |
| Authentication | employee login/logout events; failed credential attempts are rate-limited and logged operationally without recording passwords |

Actions not present in the MVP cannot silently bypass auditing because there is no corresponding mutation endpoint. If partial refunds, ticket-scan overrides, manual inventory edits, showtime bulk cancellation, comps, or editable permission definitions are added later, their design review must add an atomic audit event and a tenant-isolation test before the endpoint ships.

Review this table whenever a controller gains a new mutating route. CI and code review should reject sensitive writes that have neither an in-transaction AuditEvent nor an explicit documented reason.
