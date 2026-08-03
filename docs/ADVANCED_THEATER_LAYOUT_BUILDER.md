# Attend — Advanced Theater Layout Builder

## Goal

Expand the current theater layout designer so it can handle a much wider range of real-world cinema layouts.

The existing builder is a good starting point, but it is too limited if it assumes:

- one flat seating area
- one center gap/aisle
- simple rectangular rows
- one level
- mostly uniform seat spacing

The upgraded builder should support independent theaters with unusual room shapes, multiple aisles, balconies, stadium seating, ADA platforms, stairs, exits, tables, and mixed seating layouts.

Do **not** replace the existing seat-map architecture. Extend it.

## 1. Keep the Current Basic Builder

Preserve the existing easy workflow for simple theaters:

- Add location
- Add auditorium
- Add/remove rows
- Set seats per row
- Choose seating style
- Choose screen position
- Mark individual seats as standard / ADA / companion / not-a-seat
- Save layout

A simple 6-row rectangular cinema should still take only a few minutes to configure.

Do not make every user deal with advanced tools.

Add an **Advanced Layout Mode** for rooms that need more control.

## 2. Multiple Aisles and Walkways

A row must support more than one gap.

Example:

```
Seats 1–4 | AISLE | Seats 5–12 | AISLE | Seats 13–16
```

The current concept of one hall/gap after should be generalized.

Operators should be able to add:

- center aisles
- multiple center aisles
- side aisles
- cross aisles
- rear walkways
- front walkways

Each aisle should be represented as a real layout element rather than just a visual gap.

Suggested properties:

```
Aisle
- id
- type
- width
- orientation
- x/y position
- length
- levelId
```

Possible types:

```
MAIN_AISLE
SIDE_AISLE
CROSS_AISLE
REAR_WALKWAY
FRONT_WALKWAY
```

Do not hard-code these to any specific building-code width. The operator supplies the actual dimensions.

## 3. Visual Layout Editor

Add a more flexible visual editing surface.

The operator should be able to select:

```
Seat
Row
Aisle
Stairway
Wall
Door / Exit
Wheelchair Space
Companion Seat
Table
Text / Label
```

and place or modify those elements.

The editor should support:

- click to select
- drag to reposition
- duplicate
- delete
- align
- mirror
- resize where appropriate
- undo/redo

Do not require pixel-perfect architectural CAD behavior. The goal is *operationally accurate cinema seat maps*, not replacing AutoCAD.

## 4. Flexible Rows

Rows should no longer have to be perfectly uniform.

Support layouts like:

```
Row A   10 seats
Row B   12 seats
Row C   4 seats  aisle  8 seats
Row D   4 seats  aisle  8 seats  aisle  4 seats
```

Individual seats should be removable or repositionable.

Rows may:

- start at different horizontal positions
- have different seat counts
- contain multiple gaps
- have curved/staggered appearances
- use different spacing

The database should continue storing seats individually so ticket inventory remains seat-based.

## 5. Multiple Levels

Add support for auditoriums with more than one seating level.

Example:

```
Theater 1

LEVELS
Main Floor
Balcony
```

or:

```
Lower Floor
Upper Floor
```

Each level gets its own:

- rows
- seats
- aisles
- stairways
- wheelchair spaces
- entrances/exits
- screen orientation/reference

Suggested hierarchy:

```
Auditorium
  ↓
SeatMap
  ↓
SeatMapLevel
  ↓
Layout Elements
```

Possible model:

```
SeatMapLevel
- id
- seatMapId
- name
- sortOrder
- elevationLabel
```

Do not model different levels as separate auditoriums. They are still one auditorium/showtime.

## 6. Stadium / Tiered Seating

The builder should support stadium seating conceptually.

Rows can have elevation/tier information. For example:

```
Row A elevation: 0
Row B elevation: +12"
Row C elevation: +24"
```

This does not need to become an architectural engineering system. We mainly need enough information to:

- accurately represent the room
- distinguish levels/tiered sections
- support future visualization
- produce sensible seat maps

## 7. Stairways

Stairways should become explicit layout elements.

Properties might include:

```
Stairway
- id
- levelId
- width
- x/y
- orientation
- length
```

They should visually appear on the staff/admin layout. Customer-facing seat maps may render them more subtly.

## 8. Doors and Exits

Allow operators to place:

- auditorium entrance
- exit
- emergency exit
- balcony entrance
- service entrance

Suggested type:

```
DOOR
EXIT
EMERGENCY_EXIT
SERVICE_DOOR
```

These are primarily for layout orientation and operations. Do not automatically claim a layout is building-code compliant. Attend should not act as an architect/code inspector.

## 9. ADA / Accessible Layouts

Keep the existing:

```
STANDARD
ADA
COMPANION
NOT_A_SEAT
```

behavior, but make ADA spaces more flexible. A wheelchair position should be able to exist without being forced into the same geometry as a normal seat. For example:

```
[ wheelchair ] [ companion ]
```

or multiple wheelchair positions along a rear platform.

Support:

- wheelchair spaces
- companion seats
- removable seats
- accessible platforms

These must remain actual sellable/reservable inventory where appropriate.

## 10. Different Seating Styles

Allow the auditorium or individual sections to use different seating configurations.

Examples:

```
Single seat
Two-seat pair
Love seat
Table with 2 seats
Table with 4 seats
Bench / sofa
```

For Attend's dine-in cinema use case, preserve `tableGroupId` and `tablePosition`, but generalize it enough that layouts are not limited to two-seat pairs.

Possible future model:

```
SeatingGroup
- id
- type
- capacity
```

Types:

```
PAIR
LOVESEAT
TABLE_2
TABLE_4
BENCH
```

Do not break the current two-seat paired-table behavior.

## 11. Sections

Allow an auditorium to optionally contain seating sections.

Example:

```
Main Floor
  Left
  Center
  Right

Balcony
  Left
  Center
  Right
```

or:

```
Premium
Standard
Balcony
```

A section can have:

- name
- price tier
- default seating style
- visual label

This could eventually support pricing and reporting.

## 12. Seat Numbering / Row Labels

Add automatic numbering tools.

Examples:

```
Auto-number seats:
1 → 16
```

or:

```
16 → 1
```

Allow:

- numeric
- odd/even numbering
- custom labels

Rows should support:

```
A
B
C
```

or

```
AA
BB
CC
```

Also include **reverse row direction** for theaters where numbering runs from opposite sides.

## 13. Layout Templates

Provide templates so most customers do not need to build from scratch.

Initial templates:

```
Flat Floor
Stadium Seating
Two-Aisle Theater
Center-Aisle Theater
Balcony / Two Level
Dine-In Table Seating
Accessible Layout
```

Templates should create editable layouts, not locked configurations.

## 14. Duplicate Auditorium

Add **Duplicate Theater**. This is useful for cinemas with several similar auditoriums.

Example:

```
Duplicate Theater 2
→ Theater 3
```

Then the operator makes small adjustments.

## 15. Preview Modes

Provide at least:

**Admin Layout Preview** — shows:

- seat numbers
- aisles
- wheelchair locations
- stairs
- exits
- sections
- levels

**Customer Preview** — shows what ticket buyers will actually see.

This is important because operational layout detail should not necessarily clutter the customer-facing seat map.

## 16. Capacity Summary

The editor should calculate:

```
Sellable seats: 92
Wheelchair positions: 4
Companion seats: 4
Blocked/non-seat positions: 6

Total admission capacity: 100
```

For multiple levels:

```
Main Floor       76
Balcony          24
---------------------
Total            100
```

## 17. Versioning

Preserve Attend's existing seat-map versioning concept. Once tickets are sold for a showtime, editing the auditorium layout must **not alter the historical seat map used by that showtime**.

Editing a live theater should create:

```
SeatMap Version 2
```

Future showtimes can use V2. Existing sold showtimes continue pointing at V1. This is a critical requirement.

## 18. Ticketing Compatibility

The new editor must not create a second inventory system. Every sellable seat/position still eventually becomes:

```
Seat
  ↓
ShowtimeSeat
  ↓
SeatHold
  ↓
Ticket
```

The advanced layout is a better way to **define the physical SeatMap**, not a change to how Attend sells seats.

## 19. Layout Data

The current `layoutJson` concept can be expanded to store visual/layout components.

For example, `SeatMap.layoutJson` could contain:

```
levels
rows
aisles
walls
doors
stairs
labels
sections
visual geometry
```

But actual sellable seats should remain normalized database records.

Important rule: **Visual geometry can live in layout JSON. Financial/ticket inventory cannot depend solely on arbitrary JSON.**

## 20. Import / Export

Eventually support **Export layout** and **Import layout**. This makes migration between Attend instances or duplication easier.

Image/PDF floor-plan import can be considered later, but do not make automatic floor-plan recognition part of the initial feature.

## 21. Validation

The editor should catch obvious configuration problems. Examples:

```
Duplicate seat label A12

Seat is outside defined level

Two seats share the same identifier

Companion seat references missing wheelchair position

Two layout elements occupy exactly the same position
```

But do not attempt to certify:

- ADA compliance
- fire code
- egress compliance
- building code

Attend can model what the operator provides; it should not represent itself as an architectural compliance tool.

## 22. UX Principle

The most important design principle: **Simple theaters stay simple. Complex theaters become possible.**

A three-screen independent should still be able to create:

```
6 rows
16 seats each
```

in minutes.

Only theaters that need advanced layouts should have to interact with:

```
levels
aisles
stairs
sections
doors
custom positioning
```

Use a progressive workflow:

```
Basic Layout
  ↓
Advanced Layout
```

rather than making the advanced editor the default.

## 23. Do Not Change These Systems

This feature must **not** redesign:

- ticket checkout
- seat holds
- ShowtimeSeat inventory
- payment architecture
- merchant-of-record model
- restaurant tabs
- customer ticketing
- QR tickets

This is specifically an enhancement to **Auditorium + SeatMap configuration**. Everything downstream should continue consuming the same authoritative seats/inventory.

## Desired End Result

A cinema like Meridian should be able to create a simple layout quickly.

But Attend should also be capable of accurately representing a theater like:

```
Main Floor

4 seats
aisle
8 seats
aisle
4 seats

cross aisle

6 seats
aisle
10 seats
aisle
6 seats

Balcony

8 seats
aisle
8 seats
```

with multiple aisles, stairs, wheelchair spaces, companion seating, exits, seating sections, and multiple levels — without requiring custom code for that theater.

## Implementation Guardrail

Before changing code, inspect the current auditorium, SeatMap, Seat, `layoutJson`, shared seat-map UI, ShowtimeSeat generation, and seat-map versioning implementations. Produce a brief implementation plan describing which existing pieces will be extended. Do not create a parallel layout or seat-inventory system. Preserve all existing Milestone 1–3 behavior and tests.
