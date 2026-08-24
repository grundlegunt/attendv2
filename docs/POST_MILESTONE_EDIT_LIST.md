# Attend — Post-Milestone Product Feedback

Status: Reconciled August 24, 2026. This document records the disposition of direct owner feedback after the milestone plan; it is not an active engineering queue. Use `POST_MVP_BACKLOG.md` for unresolved product work.

## Admin feedback now implemented

- Attend Master and cinema Admin have distinct responsibilities. Master handles client onboarding and platform-wide controls; cinema operators retain day-to-day location, schedule, film, menu, public-content, employee, pricing, and reporting controls.
- Admin links to the customer site, Staff POS, and KDS where configured and permitted.
- Reserved-seat and general-admission auditoriums are supported. Selected showtimes expose reserved-seat inventory or GA capacity/sales counts as appropriate.
- The auditorium builder keeps a fast Basic workflow and an optional Advanced workflow. See `ADVANCED_THEATER_LAYOUT_BUILDER.md`.
- Menu management supports structured categories, stations, items, modifiers, availability, specials, and a published image/PDF presentation with customer preview behavior.
- Revenue reporting includes distributor/cinema allocation from dated film terms and distributor box-office detail export.
- Admin uses a labeled persistent sidebar and focused domain routes. See `ADMIN_APP_STRUCTURE.md`.
- The sign-in surface uses Attend's standard pre-authentication identity; tenant branding applies after a valid location session is known.
- Scheduling supports saved weekly alternatives, preview/duplicate/rename/delete actions, complete daily schedules, past dates, clear/remove actions, move undo, bulk updates, conflict detection, and cinema-timezone date handling.
- Employee credentials, roles, permissions, location settings, promotions, refunds, taxes, service charges, gift cards, audit history, private-event inquiries, expenses, and global search have dedicated operational surfaces.

## Customer-site feedback now implemented

- Public navigation includes Showtimes, Coming Soon, Just Announced, Film Series, Open Captions, Dining & Bar, Account, About, and an optional external Merch link. Directions and Private Events are also public routes.
- Landscape and vertical movie artwork have separate URLs and focal-position controls; dining specials can use their own paired image.
- Dining & Bar renders the published menu presentation and an accessible structured menu.
- The Afterglow content is operator-managed and integrated into the published dining experience.
- Customer-site typography, colors, logo, content, and artwork presentation are controlled through the branding/content workflows within the supported design system.
- Showtime date selection and labels use cinema-local calendar dates.
- The desktop showtime grid remains **three cards per row**. The earlier request for two was explicitly superseded by the owner's later decision to keep three.

## Platform and correctness feedback now implemented

- Automated integration coverage exercises tenant isolation and rejects cross-tenant access.
- Attend Master has platform roles, team credential reset, activation controls, audit history, client search, branding/content studios, onboarding, and payment-readiness views.
- Film Series is managed explicitly and appears through the public program rather than title matching.
- Open Captions uses a real showtime presentation attribute; Just Announced uses the upcoming program's creation order; Merch is a validated optional external URL.
- Promotions support operational controls and reporting. Bulk marketing send and experimentation remain separate provider/consent decisions.

## Remaining decisions

Only the unresolved items retained in `POST_MVP_BACKLOG.md` should be treated as candidates for new work. They include:

- validating whether the selected-showtime workspace should become a compact inspector;
- identifying the exact Staff POS tipping path, if any, that still needs a collection surface;
- defining disclosure and eligibility before adding fallback gratuity;
- selecting privacy-reviewed analytics, wallet, SMS, or bulk-marketing providers and their consent/cost policies;
- deciding whether a softer organization-suspension mode or broader internal platform roles are needed as real operations expand;
- pursuing nonprofit, multi-location, timed-entry, or other adjacent-market features only when a concrete customer supplies the requirements.

## Guardrails

- Do not reopen resolved feedback from this historical list without a reproducible current case.
- Treat layout preferences and workflow redesigns as product decisions, not inferred bug fixes.
- Keep the three-column showtime-grid decision unless the owner explicitly changes it again.
- Preserve cinema-timezone behavior, tenant isolation, idempotency, permission enforcement, and historical financial integrity in all follow-up work.
