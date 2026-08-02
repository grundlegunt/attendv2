# Attend — Weekly Programming & Showtime Scheduling

## Purpose
Attend should include a dedicated cinema programming and scheduling workspace that makes it fast and intuitive for a theater operator to build and manage a full weekly film schedule across multiple auditoriums. It should extend the existing Movie, Showtime, Auditorium, ticket-sales, and reporting architecture rather than replace it.

## Core Scheduling Requirements
- Weekly calendar/grid showing all auditoriums and Monday–Sunday programming.
- Showtime start times plus internal runtime, preshow, cleaning/turnover, and room-availability calculations.
- Drag-and-drop placement and adjustment of movies/showtimes.
- Automatic auditorium conflict detection with useful explanations.
- Repeat showtimes across every day, weekdays, weekends, selected days, or custom patterns.
- Copy one day to another and duplicate one week into the next.
- Reusable weekday/weekend schedule templates.
- Ability to move future screenings between auditoriums.
- Capacity, tickets sold, sell-through, and relevant revenue visibility directly in the calendar.
- Draft versus published schedules and a publish-week workflow.
- Private rentals, maintenance, projection work, staff training, and other auditorium holds.
- Support for classics, repertory, 35mm/70mm, midnight films, festivals, Q&As, premieres, rentals, member screenings, special events, and double features.
- Screening labels such as 35MM, 70MM, Q&A, MEMBERS, SOLD OUT, OPEN CAPTION, LATE NIGHT, and PRIVATE EVENT.
- Auditorium capability restrictions such as film formats, digital cinema, 3D, stage, microphone/Q&A setup, and accessibility information.
- Configurable location operating hours with manager overrides.
- Strict warnings/workflows before changing a movie, time, auditorium, or cancellation after tickets have sold.
- Customer website, box office, staff tools, reporting, signage, and future APIs should derive from the same authoritative schedule.

## Customer-Facing Showtime Display

Customers should see the advertised showtime start time. Internal operations may separately track preshow start, feature start/end, cleaning, and when the auditorium becomes available.

### Past Showtime Display Behavior

Showtimes that have already started must NOT disappear from the customer-facing schedule during that same calendar day.

Example — today's schedule:
- 11:00 AM
- 2:30 PM
- 5:00 PM
- 7:30 PM
- 10:00 PM

If the current time is 5:15 PM, the customer should still see:
- 11:00 AM — past / disabled
- 2:30 PM — past / disabled
- 5:00 PM — past / disabled
- 7:30 PM — available
- 10:00 PM — available

Past showtimes should:
- remain in their original chronological position;
- appear visually disabled or muted;
- not be clickable;
- not allow checkout, ticket selection, or seat selection;
- optionally show a subtle "Past" state if useful without unnecessary clutter.

Upcoming showtimes remain actionable according to normal sales rules.

The rule is based on the advertised showtime start time / applicable purchase cutoff, not when the feature finishes. A 5:00 PM screening viewed at 5:15 PM remains visible but disabled.

Past showtimes only need to remain visible as part of that day's customer schedule. Previous dates should not accumulate on the normal current-day view.

This display rule must not remove or alter historical showtimes. Staff/admin users must retain access to past screenings for ticket counts, attendance, revenue, refunds/customer service, reporting, and audit history.

Implementation rule:
- PAST TODAY = visible + disabled
- UPCOMING TODAY = visible + actionable
- FUTURE DATE = visible + actionable according to normal sales rules

This should be a targeted change to showtime filtering/rendering, not a redesign of ticketing, inventory, checkout, payments, or the Showtime model.

## Future Programming Assistance
Attend may eventually provide recommendations based on sales and historical performance—for example, suggesting that a high-demand movie move into a larger auditorium or identifying consistently underperforming screenings. These must remain recommendations; the programmer stays in control.

Future forecasting may combine advance sales, historical performance, day of week, showtime, auditorium size, film, weeks since opening, and holidays to estimate attendance.

## Desired Operator Experience
A cinema programmer opens Attend, selects next week, and sees Monday–Sunday across all auditoriums. They can drag films into rooms, create recurring showtimes, copy schedules, make weekend adjustments, add special programming, identify conflicts, and review advance sales.

Attend handles runtime calculations, preshow and turnover buffers, conflicts, repeating showtimes, schedule duplication, capacity information, sales visibility, and publishing.

The programmer focuses on what movies should play, where they should play, and when they should play.

## Product Principle
Attend should function as a visual programming workspace for operating a movie theater:

Program the theater → Publish the schedule → Sell tickets → Observe performance → Adjust future programming.

## Implementation Timing and Guardrails
Do not interrupt the current ticketing/payment milestone. Once the core ticketing workflow is stable, introduce this as a Programming & Scheduling Module using the existing Movie, Showtime, Auditorium, ticket-sales, and reporting data.

Preserve the existing scheduling foundation: movie runtime, calculated end time, preshow buffer, cleaning buffer, auditorium conflict detection, and published showtimes.

Before implementation, inspect the existing scheduling and customer-facing showtime logic and produce an implementation plan describing which existing pieces will be extended. Do not create a parallel scheduling system or duplicate source of truth.

## Production Rollout

The production module should grow in vertical slices while keeping `Showtime` as the authoritative schedule:

1. **Daily visual scheduler** — auditoriums are rows, time is horizontal, and every block covers advertised start through pre-show, runtime, and cleaning. Clicking open time creates a draft; clicking a block edits the real showtime. The API remains responsible for conflict enforcement.
2. **Programming workflow** — add repeat patterns, copy day/week, schedule templates, presentation labels, room moves, draft review, and publish-week controls. Any showing with sold tickets receives a stricter change/cancellation workflow.
3. **Flexible auditorium designer** — replace rectangular row-count setup with per-row seat counts, aisle/gap placement, paired and individual seats, wheelchair/companion/not-a-seat positions, and screen orientation. Continue storing layouts through the existing structured SeatMap/Seat model.
4. **Multi-location cinema groups** — operators with permission at multiple locations may switch among only those locations. Each location retains its own rooms, layouts, schedules, prices, and staff scope.
5. **Attend platform operations** — cross-client organization/location switching requires a dedicated platform-admin authorization boundary and tenant-safe API. A client-facing location selector must never be repurposed to expose unrelated organizations.

The visual direction should retain the useful patterns from the approved prototypes at `attend-cinema-platform.vercel.app/schedule` and `/theaters`, but prototype-only controls must not appear as functional until their API, permission, audit, and persistence paths are real.
