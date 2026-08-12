# Attend Master — Client Vertical / Business Type

## The ask

When Attend Master onboards a new client, it should be able to record what kind of
business it is — movie theater, event operator, venue (concert/sports/etc.) — rather
than assuming every client is a cinema. Confirmed in code: there's no such field
today. `Organization` (`packages/database/prisma/schema.prisma`) has no
type/vertical/category concept at all, and nothing else in the schema distinguishes
one kind of client from another.

## Two different things this could mean — don't conflate them

**A. A classification label on the client record.** Master lets you tag an org as
`MOVIE_THEATER` / `EVENT_VENUE` / `OTHER` (exact set TBD) purely for Attend's own
bookkeeping — sales pipeline, client list filtering, knowing at a glance what kind of
business you're managing. This changes nothing about how the product behaves for that
client. Cheap: one enum field, one dropdown in the onboarding form and client profile.

**B. Actually supporting non-cinema clients.** A concert venue or sports venue
client gets a real, working product built around what *they* need — not a movie
theater with the word "Movie" find-and-replaced. This is a large undertaking, not a
field. Every one of Attend's 55 database models assumes a movie theater running
scheduled film screenings in fixed auditoriums:

- `Movie` / `Showtime` / `Auditorium` / `SeatMap` / `FilmSeries` are all
  film-screening-specific — there's no generic `Event` or `Venue Space` concept
  underneath them to generalize from.
- `MoviePairing` links menu items to specific movies for the dine-in concessions
  pairing feature — a concert or sports venue's F&B model isn't "paired with a film."
- The whole customer journey (`/showtimes`, `/film-series`, `/coming-soon`, movie
  detail pages with director/starring/trailer) is written in cinema-specific language
  throughout `apps/customer-web`, not as a themed skin over something generic.
- General-admission ticketing (a concert with no assigned seats) doesn't exist as a
  concept — every ticket in the system is tied to a specific seat via `ShowtimeSeat`.

Building B means designing a real generalization (`Movie`→ something like
`Program`/`Title`, `Auditorium`→ `Venue Space`, optional seat maps, a ticketing model
that supports both reserved and general-admission) validated against an actual second
vertical's real requirements — not guessed at in the abstract.

## What to actually do now

A only. Add the classification label — it's honest, it's nearly free, and it means
Master's own client list isn't silently assuming every future client is a cinema.
It does **not** commit Attend to building B, and shouldn't be treated as if it does.

Do not start on B. There's no second, non-cinema client to build it against yet —
confirmed this is a forward-looking classification, not something needed for a
specific client in the near term. Generalizing the domain model now would mean
designing against guesses about what a concert or sports venue needs instead of a
real one's actual requirements, which is exactly backwards from how every other part
of this product has been built so far (the film-series, dining-pairing, and
reserved-seating features were all built against Meridian's real, specific needs).

When a real non-cinema client is actually being onboarded, that's the point to scope
B properly — probably starting with "what does *this* venue's ticketing actually need"
rather than trying to generalize for every conceivable event type at once.

## Guardrails

- Don't rename or restructure `Movie`/`Showtime`/`Auditorium` as part of adding the
  label — A and B are unrelated pieces of work with very different costs.
- Don't let the classification field's existence imply non-cinema onboarding is
  supported in the product — if someone picks "Event Venue" in Master today, nothing
  downstream should change, because nothing downstream is built for it yet.
