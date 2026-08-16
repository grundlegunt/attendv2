# Industry-Standard Gaps — Cinema Features and General Website Services

Two different categories of "what are we missing that's now standard elsewhere":
cinema/dine-in-specific features (researched against current industry sources, not
just assumed), and generic website infrastructure any real business site needs.
Every item below was checked against the actual code, not inferred.

## Part 1 — Cinema and dine-in POS industry standards

### Self-service in-seat ordering via QR code — the biggest gap here

This is a named, specific pattern in the dine-in-cinema category specifically, not
a generic trend: GoTab markets its POS directly to movie theaters for exactly
this — guest scans a QR code at their seat, orders and pays from their own phone,
the order routes straight to the kitchen, and they get notified when it's ready.

Confirmed in code: Attend doesn't have this. `CustomerRestaurantTabController`
(`apps/api/src/restaurant/restaurant-settlement.controller.ts`) only exposes
`GET :tabId` (view the tab) and `POST :tabId/tip` — no endpoint for a customer to
add an item to their own tab. Every order today goes through a staff member on
`apps/staff-pos`. Given how much correctness work has already gone into the
seat-linked tab and settlement system, adding a customer-facing "add item" endpoint
that writes into that same system is a real feature, not a rewrite — but it's the
single closest-to-mandatory item in this whole list for the category Attend is
actually in.

### Apple Wallet / Google Wallet ticket passes

Standard for mobile ticketing broadly now. Confirmed nothing in this codebase
generates an installable wallet pass — tickets exist as QR codes for the scanner,
nothing more.

### SMS

No SMS provider configured anywhere (only Postmark for email, confirmed via
`packages/config/src/env.ts` and `apps/api/.env.example`). Matters specifically
because the in-seat ordering pattern above depends on it — "your food is ready" and
day-of showtime reminders are typically texts industry-wide, not emails.

### Waitlist for sold-out showtimes

Common at popular independent cinemas — "notify me if a seat opens up." Nothing
like it exists in Attend today.

### Loyalty/membership programs

Already flagged (`docs/VEEZI_FEATURE_COMPARISON.md`, and matches Codex's own
"longer-term, deferred" list) — repeating here because current research describes
this as standard across the category now, not just a differentiator.

### Already covered elsewhere, not repeated in full here

Automated win-back/marketing email and real concession inventory tracking — both
already scoped in `docs/VEEZI_FEATURE_COMPARISON.md` and `docs/PROMOTIONS_AND_CAMPAIGNS.md`.

## Part 2 — General website services, not cinema-specific

Checked `apps/customer-web` directly for each of these.

- **No Open Graph / social-share metadata.** `apps/customer-web/app/layout.tsx`
  has one static `{ title: "Cinema", description: "..." }` for the entire site —
  no per-page metadata, no `og:image`. Sharing a showtime or movie link shows a
  generic card, not the movie's own poster and title, even though that data
  already exists and just isn't wired into page metadata (`generateMetadata` per
  route in Next.js is the standard way to fix this).
- **No analytics** — no Google Analytics/GTM, no Meta Pixel, nothing. No visibility
  into traffic, checkout funnel drop-off, or referral sources beyond what checkout
  itself records.
- **No sitemap.xml or robots.txt** — hurts basic search discoverability.
- **No customer "forgot password" flow.** Checked the auth routes directly — there
  is no reset-password endpoint for customers at all today. Treat this as an
  account-usability gap, not just SEO/marketing hygiene — a customer who forgets
  their password currently has no self-service way back into their account.
- **No cookie-consent banner.** Lower priority on its own for a single venue, but
  becomes relevant the moment analytics or ad pixels are added — do it alongside
  that work, not as an afterthought once pixels are already live.
- **No PWA manifest.** Ties directly to the earlier website-vs-app discussion — the
  "make it installable as a home-screen app" recommendation depends on this
  existing, and it doesn't yet.
- **No error tracking (Sentry or equivalent).** Not new — already sitting in
  Codex's own "production readiness" checklist from earlier in this project
  (monitoring/alerting/error tracking/backups). Repeated here because it's also
  just standard infrastructure for any real production website, cinema or not.

## Guardrails

- Part 1's in-seat ordering item is the one worth prioritizing above the rest of
  this doc — it's closer to a category expectation than a nice-to-have for a
  dine-in cinema specifically.
- Part 2's forgot-password gap is a real usability bug in waiting, not cosmetic —
  treat it with more urgency than the SEO/analytics items around it.
- None of this is urgent-blocking in the way production-readiness items are before
  a real launch — but the forgot-password gap and the in-seat ordering gap are both
  closer to "expected to exist" than "nice differentiator," and worth weighing
  against the rest of the backlog accordingly.
