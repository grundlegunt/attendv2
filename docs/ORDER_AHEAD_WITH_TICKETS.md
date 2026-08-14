# Order Food & Drink Ahead, During Ticket Checkout

## What's being asked

The reference prototype (`attend-cinema-platform.vercel.app` — visual reference
only, not the real product; see `docs/PROGRAMMING_AND_SCHEDULING.md`) shows a
seat-selection screen with an "Order ahead" panel: scroll the food & drink menu and
add items with quantity controls *before* completing ticket checkout, so food is
already queued when the customer sits down.

Confirmed directly: this doesn't exist anywhere in the real product. Checked
`apps/customer-web/app/showtimes/page.tsx` and the ticketing API — zero references
to menu items or food ordering anywhere in the ticket checkout path. Ticket
purchase and restaurant ordering are currently two fully separate flows.

## Why this is a real integration question, not just a UI addition

Two things already exist independently and would need to connect:

- **Ticket checkout** — `PaymentPurpose` has exactly three values today
  (`TICKET_ORDER`, `RESTAURANT_TAB`, `GIFT_CARD_PURCHASE`) — no combined
  ticket-plus-food purpose or line-item structure.
- **Seat-linked dining tabs** — already real (`POST /restaurant-tabs/seat-linked`),
  but today a seat-linked tab gets created separately from ticket purchase, normally
  once a customer is seated.

Adding "order ahead" means deciding how these connect, not just adding a menu
picker to the checkout page. The central question: **when a customer buys tickets
with food added, does that automatically create and populate their seat-linked tab
at the same time — so a server never has to re-enter what was already ordered — or
does it stay a separate step that happens to be shown early?** The prototype's own
copy ("You can still order more from your server") implies the first: pre-ordered
items should already be on the tab by the time a server reaches the table, not just
a wishlist the guest re-orders in person.

Related, and worth deciding at the same time rather than as an afterthought:

- **Payment**: is the food charged together with the tickets in one checkout, or
  authorized separately (a card-on-file style hold, charged later when the tab
  closes, the way in-person orders work today)? This determines whether it's really
  a new `PaymentPurpose`/checkout line-item change, or a pre-order queued against a
  tab that gets its own normal settlement later.
- **Timing**: can items be added ahead only up to some cutoff (e.g., not usable for
  a showtime that already started), and can a customer change or cancel a
  pre-order before the kitchen sees it?
- **Kitchen/bar timing**: should a pre-order fire to the kitchen immediately on
  purchase, or hold until the showtime is closer to start (a pre-order placed
  three days ahead of an evening showtime shouldn't route to the kitchen queue
  three days early)?

## What NOT to do

Don't build a UI-only version that just shows a menu at checkout and creates a
disconnected order a server has to notice and manually merge — that reproduces the
exact problem seat-linked tabs already solve for in-person ordering, just earlier
in the timeline.

## Guardrails

- This needs the payment/timing decisions above made explicitly before starting —
  don't infer an answer and build against it.
- Reuse the existing seat-linked tab and kitchen fulfillment systems rather than
  building a parallel pre-order pipeline — the goal is one tab per seat/party, not
  two systems that both think they own "what this table ordered."
