# Attend: Timed-Entry & Attractions Expansion Plan

How Attend can expand from cinema ticketing into exhibitions, immersive experiences, museums, attractions, and other timed-entry events without changing its core business model.

## Core Principle

Do not build a separate exhibition ticketing product. Expand Attend so each event can use assigned seating, timed-entry capacity, or general-admission inventory. Keep the current direct-to-organizer payment model: the venue or organizer remains merchant of record and receives customer funds directly.

## 1. Strategic Direction

Attend should remain commercially focused on independent movie theaters in the near term. Technically, however, its ticketing core should be able to support other venue types without a rewrite. The goal is to specialize in cinema as the initial market while avoiding cinema-only assumptions in the underlying data model.

### The key abstraction

Current cinema model:

```
Movie → Showtime → Auditorium → Seats → Tickets
```

Future generalized model:

```
Event → Session → Inventory → Tickets

Inventory type:
  ASSIGNED_SEATING
  TIMED_ENTRY
  GENERAL_ADMISSION
```

Cinema continues to use `ASSIGNED_SEATING`. An exhibition such as *Harry Potter: The Exhibition* would use `TIMED_ENTRY`. General-admission events could be supported later using the same foundation.

## 2. What Attend Would Need to Add

### 2.1 Event / inventory type

When an organizer creates an event, Attend should allow an inventory model to be selected:

> What type of event is this?
> ○ Reserved Seating&nbsp;&nbsp;○ Timed Entry&nbsp;&nbsp;○ General Admission

Existing cinema workflows should continue to default to Reserved Seating. Timed Entry should use capacity instead of seat assignments.

### 2.2 Timed-entry session generation

The organizer needs to define an operating calendar rather than manually creating every time slot. Example:

```
Harry Potter: The Exhibition
DATES               September 1 – January 15
OPEN                10:00 AM – 8:00 PM
ENTRY INTERVAL      Every 30 minutes
CAPACITY PER SESSION 175 guests
```

Attend would automatically generate sessions such as:

```
September 1
10:00 AM   175 available
10:30 AM   175 available
11:00 AM   175 available
11:30 AM   175 available
...
7:30 PM    175 available
```

Operators should be able to override individual dates and sessions, for example a higher Saturday capacity, an early close on Christmas Eve, or a fully closed holiday.

### 2.3 Flexible ticket categories

Timed-entry events need multiple ticket products and rules. Example:

```
ADULT    $39.00
CHILD    $29.00
SENIOR   $34.00
VIP      $59.00
```

A ticket category should be able to carry its own price, eligibility, benefits, capacity allocation, and admission rules. This same system is useful for cinemas: Adult, Child, Senior, Student, Member, Matinee, 70mm Premium, VIP, complimentary, press, and staff.

### 2.4 Capacity inventory and holds

Assigned seating manages specific seats. Timed entry manages the remaining quantity in a session.

```
2:00 PM
Capacity:    175
Sold:        121
Held:          8
Available:    46
```

Attend can reuse the same conceptual hold system already needed for seats. When a customer selects four tickets, four capacity units are temporarily held during checkout. Successful payment converts the hold to sold inventory; an expired checkout releases it back to the session.

### 2.5 Customer purchase flow

Cinema purchase flow:

```
Choose Movie → Choose Showtime → Choose Seats → Choose Ticket Types → Checkout
```

Timed-entry purchase flow:

```
Choose Date → Choose Time → Choose Ticket Types + Quantity → Add-ons → Checkout
```

This does not require a second consumer site. The Attend storefront and checkout can render differently according to the event inventory type.

### 2.6 Add-ons and bundled commerce

Timed-entry events often sell upgrades alongside admission. Attend should eventually allow configurable add-ons such as:

```
Audio Guide        $8
Souvenir Program   $15
Photo Package      $25
Parking            $12
Collector Package  $40
```

This capability also benefits cinemas, where add-ons can include popcorn, wine, dinner packages, parking, collectible merchandise, or premium experiences. It reinforces Attend's larger advantage: connecting ticketing with on-site commerce.

### 2.7 Flexible admission rules

Unlike a movie seat, a timed-entry ticket may have an admission window or flexible validity. The ticket rules engine should support examples such as:

- **STANDARD ENTRY** — Valid from 15 minutes before the session through 30 minutes after the session.
- **FLEX TICKET** — Valid for any session on the selected date, subject to available capacity.
- **VIP** — Valid at any time from 10:00 AM – 8:00 PM.

### 2.8 QR scanning and access control

The same Attend scanner can validate cinemas and timed-entry attractions, but it should understand ticket rules rather than only ticket existence.

- ✅ Harry Potter: The Exhibition — 2:30 PM Entry, Adult — **ADMIT**
- ⚠ **EARLY** — Ticket: 3:30 PM, Current time: 2:42 PM
- ❌ **ALREADY USED** — Scanned: 2:37 PM, Entrance: Gate B
- ⭐ **VIP** Priority Entry

The scanner should support used/unused status, early or late entry rules, multiple gates, supervisor overrides, ticket class recognition, and clear audit history.

### 2.9 Exchanges and rescheduling

This is more important for attractions than for cinema and is one of the larger development additions. Attend should eventually support changing a reservation to a different session while preserving inventory correctness.

```
Saturday 2:30 PM
   ↓
Sunday 11:00 AM

Availability: ✓
Price difference: $0
[CONFIRM]
```

1. Release the old session inventory.
2. Reserve capacity in the new session.
3. Calculate and collect or refund any price difference.
4. Invalidate old ticket credentials where necessary.
5. Issue or update the customer's tickets and confirmation.

### 2.10 Multi-location organizer support

Touring exhibitions and larger operators may manage many locations under one organization. Each location should be able to maintain its own merchant account, capacity, calendar, prices, taxes, inventory, employees, and reporting while corporate users can view aggregate performance.

```
ATTEND — Harry Potter: The Exhibition — ALL LOCATIONS — Today
Tickets sold      12,481
Gross sales       $493,820
Refunds           $9,331
Guests admitted   9,827

Chicago  Atlanta  Boston  Dallas
```

## 3. Payment Architecture Must Stay the Same

Expanding into timed-entry events should not change Attend's business model. The organizer or venue remains merchant of record. Attend provides the ticketing and payment technology, while ticket funds settle directly to the organizer's connected payment account.

```
CINEMA
Customer → Attend Checkout → Theater merchant account → Theater bank

TIMED-ENTRY EXHIBITION
Customer → Attend Checkout → Organizer merchant account → Organizer bank
```

| Role | Responsibility |
| --- | --- |
| Organizer / venue | Merchant of record; receives customer funds directly. |
| Attend | Ticketing, inventory, checkout, payment integration, admission, reporting, venue operations. |
| Marketplace / distribution partner | Optional source of demand or sales channel; not required to control the organizer's settlement flow. |

**Architectural rule for future implementation:** Timed-entry events MUST use Attend's existing connected-merchant architecture. Attend is not merchant of record. The organizer remains merchant of record and receives customer funds directly. Do not create an Attend-controlled balance, custodial wallet, or organizer payout system.

## 4. Distribution Channels Can Come Later

Attend does not need to become a consumer marketplace in order to support large exhibitions. In the longer term, it can expose inventory to external marketplaces while keeping Attend as the event and inventory system of record.

```
        DEMAND: Fever, Google, Other channels
                       \   |   /
                        ATTEND
          Ticketing + Inventory + Checkout
              Admission + POS
                     |
                  CUSTOMER
```

A future channel-management API could synchronize availability, reservations, orders, cancellations, and channel attribution. That work is separate from the core timed-entry module and can wait until a real distribution partnership requires it.

## 5. What Not to Build Yet

- Do not build a separate "Attend Attractions" application.
- Do not change the current cinema workflows just to accommodate hypothetical future customers.
- Do not turn Attend into merchant of record or create a custodial payout system.
- Do not build Fever/Fandango/marketplace integrations before a concrete partnership requires them.
- Do not attempt international currency, tax, and payment-method coverage before the U.S. product requires it.
- Do not broaden the current product roadmap at the expense of getting cinema ticketing, POS, admission, and reporting right.

## 6. The One Thing Worth Protecting in the Current Build

Attend does not need timed-entry functionality today. However, the current code and schema should avoid assumptions that make every ticket permanently dependent on a seat or auditorium.

Avoid hard-coding patterns such as:

```ts
ticket.seatId // always required
// Every event must belong to an auditorium.
```

Prefer a model where inventory type controls which fields are required:

```ts
inventoryType:
  | "ASSIGNED_SEATING"
  | "TIMED_ENTRY"
  | "GENERAL_ADMISSION"

seatId?: string
```

A seat should be required only when the inventory type is `ASSIGNED_SEATING`. At the platform level, the most durable concepts are Event, Session, Ticket, Order, Inventory, Hold, Admission Credential, and Merchant Account. Cinema-specific concepts such as Film, Auditorium, Row, and Seat can remain specialized extensions beneath them.

## 7. Suggested Product Roadmap

| Stage | Focus | Major capabilities |
| --- | --- | --- |
| Attend 1.0 | Independent cinemas | Reserved seating, ticketing, payments, QR admission, box office, restaurant POS, seat-to-tab, refunds, reporting. |
| Attend 1.5 | Future-proof core | Generic inventory abstraction; no assumption that every ticket requires a seat. |
| Attend 2.0 | Timed-entry attractions | Capacity sessions, recurring schedule generation, ticket categories, add-ons, admission windows, rescheduling, multi-location operations. |
| Attend 3.0 | Distribution ecosystem | Channel management, external marketplace/API integrations, partner attribution, inventory synchronization. |

## 8. Markets This Opens Up

Once `TIMED_ENTRY` exists, Attend could serve many categories adjacent to cinema without changing its core operating philosophy:

- Exhibitions and touring experiences
- Immersive experiences and pop-ups
- Museums and galleries
- Botanical gardens and zoos
- Observation decks and historic attractions
- Factory, brewery, and guided tours
- Haunted attractions and seasonal experiences
- Holiday light experiences
- Film festivals and special screenings
- Other capacity-controlled venue experiences

Commercially, Attend can still lead with "built for independent movie theaters." The opportunity is to specialize in one market without restricting the software to one market forever.

## 9. Future Claude / Codex Implementation Brief

When the cinema product is ready and Attend decides to add timed entry, the implementation request can start from the following brief:

> Extend Attend's existing ticketing platform to support TIMED_ENTRY events in addition to ASSIGNED_SEATING.
>
> Do not create a separate application. Preserve all existing cinema functionality.
>
> Timed-entry events use session-level capacity instead of seat-level inventory. Add recurring session generation, flexible ticket categories, capacity controls, inventory holds, admission windows, QR validation, exchanges/rescheduling, add-ons, reporting, and multi-location support.
>
> Continue using Attend's existing direct-to-organizer payment architecture. The organizer remains merchant of record and customer funds settle directly to the organizer's connected payment account. Do not create an Attend-controlled balance, custodial wallet, or payout system.
>
> Existing movie theaters must experience no changes to their current workflow unless they explicitly create a timed-entry event.
>
> Refactor only where necessary so the core domain model can support Event → Session → Inventory → Ticket, with ASSIGNED_SEATING, TIMED_ENTRY, and GENERAL_ADMISSION as inventory strategies. Seat and auditorium relationships must be required only for assigned-seating events.

## 10. Bottom Line

Attend can remain a movie-theater-first company while leaving the door open to HPX-style exhibitions and other timed-entry attractions. Most of the future expansion is an inventory and scheduling problem, not a new company, checkout system, or payment model. The best near-term decision is simply to keep the core ticketing architecture generic enough that capacity-based inventory can be added later without ripping apart the cinema product.
