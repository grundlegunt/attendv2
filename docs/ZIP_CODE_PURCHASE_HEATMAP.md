# Zip Code Heat Map — Where Ticket Buyers Are Coming From

## What's being asked

An operator wants to see where ticket buyers are geographically coming from — a
map showing purchase density by zip code — to understand audience reach (e.g., for
marketing spend, or evaluating a second location).

## Current state

Confirmed directly against the schema and checkout code: **nothing here exists
today.** `Customer` (`packages/database/prisma/schema.prisma`) has no
address/zip field at all — just `email`, `phone`, `name`, `isGuest`. The Stripe
integration (`packages/payments/src/stripe-payment-provider.ts`) doesn't request a
billing address either (`automatic_payment_methods: { enabled: true }` alone
doesn't collect one). There's no zip data anywhere to aggregate yet — this is a
real feature with three real pieces, not a report to add on top of existing data.

## 1. Capture — ask directly at checkout, don't rely on Stripe

Don't try to piggyback on whatever billing zip Stripe's card element might collect
for AVS/fraud purposes — that behavior isn't something this checkout flow currently
configures or relies on, and building a feature on top of undocumented,
payment-processor-internal behavior is fragile. Add a simple, optional zip code
field to the ticket checkout flow itself, framed honestly to the customer (e.g.,
"helps us understand where our audience is coming from") rather than presented as
required or billing-related.

## 2. Store — on the order, not the customer

Add `zipCode` (nullable) to `TicketOrder`, not `Customer`. The question being asked
is "where are people buying tickets *from*," which is a per-purchase fact, not a
permanent attribute of a customer profile — someone could be traveling, buying as a
gift, etc. A migration adding one nullable column, following the existing pattern
of small additive migrations already used throughout this schema.

## 3. Aggregate — a new reporting method, same pattern as what's already there

Add a method to `apps/api/src/reporting/reporting.service.ts` (already has
`revenue()`, `labor()`, `customerRecency()` — this fits directly alongside them):
group `TicketOrder` rows by `zipCode` for a given location and date range, same
range-filtering approach already used by `revenue()`. Return counts (and optionally
ticket revenue) per zip so the frontend doesn't need to do its own aggregation.

## 4. Visualize — choropleth over ZCTA boundaries, not a smoothed heatmap

Zip codes are already areal units, not points — join the aggregated counts to real
ZCTA boundary polygons (free GeoJSON/TopoJSON from the US Census) and color each
zip by density. Don't convert to lat/lng points and run a density/KDE heatmap over
them — that visually smooths across zip boundaries and misrepresents sparse zips as
continuous gradients, which isn't what the data actually says. A mapping library
(Mapbox GL JS or Leaflet, either fits this stack) with a choropleth layer fed the
aggregated counts is the standard, correct approach for this kind of data.

**Where it lives**: Admin's reporting section (`apps/admin/app/reports`, "Revenue
Overview" under the navigation restructure in
`docs/ADMIN_NAVIGATION_RESTRUCTURE.md`) is the natural home — this is per-cinema
audience insight, the same category as the existing revenue/labor reports. Master
could aggregate this across clients later if wanted, but that's a natural
extension, not part of the initial scope here.

## Guardrails

- This is real per-purchase customer data, even if a zip code alone isn't highly
  identifying. Be deliberate about who can see it (same reporting permission tier
  as existing financial reports makes sense) and whether it needs a mention in
  whatever privacy policy/consent language already exists
  (`CustomerConsent`/`docs/SECURITY.md`) — don't treat it as anonymous analytics
  by default.
- Keep the field optional and clearly framed at checkout — don't make it required
  or present it as if it's needed for payment to go through.
- Don't build this by inferring zip from IP address or any other passive collection
  method instead of asking — that's a materially different (and more invasive)
  data-collection decision than what's being asked for here.
