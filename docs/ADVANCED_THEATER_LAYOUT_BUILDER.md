# Attend — Advanced Theater Layout Builder

Status: Implemented and reconciled August 24, 2026.

## Current builder

Admin's Cinema Setup supports reserved-seat and general-admission auditoriums. Reserved seating offers two workflows:

- **Basic layout** quickly generates a rectangular room from row and seat counts.
- **Advanced layout** edits an operationally accurate multi-level seat map without requiring architectural CAD precision.

Attend Master uses the same shared layout contract when creating client auditoriums, so onboarding and cinema operations agree on the saved shape.

## Advanced capabilities

- Templates for flat floors, stadium seating, one or two aisles, balcony/two-level rooms, dine-in table seating, and accessible layouts.
- Multiple named levels with sort order and an operator-facing elevation label.
- Named sections assigned to a level.
- Individually positioned seats with row, number, label, level, section, and seating-type metadata.
- Seat types for standard, ADA, and companion inventory, plus blocked/non-seat positions.
- Seating styles for single seats, pairs, love seats, two- or four-seat tables, and bench/sofa layouts.
- Explicit aisles, stairways, walls, doors, exits, emergency exits, service doors, screens, tables, and text labels.
- Screen position and separate Admin-detail and customer-preview modes.
- Selection, drag repositioning, duplication, deletion, row/column alignment, mirroring, automatic numbering in either direction, and undo/redo.
- A layout-element inspector for labels and dimensions.

All sellable reserved positions remain individual seat records. Decorative and circulation elements live in the versioned layout document and do not become ticket inventory.

## Persistence and validation

- Layouts use the shared `SeatMapLayout` schema and advanced-layout validator.
- Seat coordinates are unique within a level and layout version.
- Levels referenced by sections, seats, or elements must exist.
- ADA companion relationships, table pairing metadata, and seating styles are normalized and validated before persistence.
- Saving a revised map creates a new layout version so future showtimes can use the new configuration without rewriting historical seat inventory.
- General-admission rooms persist capacity rather than manufacturing reserved-seat coordinates.

## Guardrails

- Keep the Basic workflow fast; advanced controls must remain optional for a straightforward rectangular room.
- Do not model balconies or upper floors as separate auditoriums when they belong to one room and showtime.
- Do not silently renumber or move seats that already back a published layout version.
- Preserve ADA and companion semantics in Admin, customer seat maps, Staff POS, and exported/printed representations.
- Treat aisle widths, elevations, exits, and labels as operator-supplied orientation data. Attend does not certify building-code or accessibility compliance.
- Customer views may simplify walls, stairs, and operational labels, but they must preserve the seat coordinates and inventory identities used at checkout.
- Keep all layout mutations location-scoped and permission-gated.

## Future scope

Any future enhancements—such as architectural imports, measured floor plans, automated code checks, or photorealistic room rendering—need an explicit product and liability decision. They are not extensions to infer from the current operational layout editor.
