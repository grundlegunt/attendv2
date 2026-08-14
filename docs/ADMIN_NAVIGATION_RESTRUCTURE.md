# Attend Admin — Navigation Restructure

The concrete target structure for Admin's side nav, replacing the "rework the side
panel" item from `docs/POST_MILESTONE_EDIT_LIST.md` with an actual spec. Checked
against the current structure (`apps/admin/app/admin-navigation.ts`) directly —
most of this is regrouping and renaming pages that already exist; a few pieces are
genuinely new. Both kinds are called out explicitly below so this doesn't get
treated as a pure rename job.

## Target structure

```
Dashboard / Overview

Films
  Schedule
  Film Library
  Film Series

Setup
  Auditorium & Seats (say "Tickets" instead, for GA/non-cinema clients)
  Branding
  Location
  Ticket Prices, Tax, Charges

F&B
  Menu
  POS

Financial Reports
  Revenue Overview
  Refunds
  Labor
  Expenses

Extras
  Private Events
  Merch
  Gift Cards
  Promos
  Memberships

Team
  Team Access
  Labor
  Recent Activity
```

## Mapping against what exists today

Most of this is moving and renaming entries in `adminNavigation`
(`apps/admin/app/admin-navigation.ts`) — the current six groups (Overview, Films,
Cinema Setup, Operations, Reports & Finance, Users & Permissions, Settings) get
reorganized into the seven above. Direct mappings, no new pages needed:

- Dashboard → same (`/`).
- Films → Schedule (`/scheduling`) and Film Series (`/film-series`) already exist
  in a "Films" group today, unchanged.
- Setup → Auditorium & Seats (`/cinema-setup`), Branding (`/branding`, currently
  labeled "Brand Status"), and Location (`/location`) already exist, just move from
  "Cinema Setup" into the renamed "Setup" group. Ticket Prices, Tax, Charges is the
  existing `/taxes` page (already labeled exactly this) — currently sits under a
  separate "Settings" group; move it into "Setup".
- F&B → Menu (`/menu`) already exists, currently under "Operations"; move it here.
- Financial Reports → Revenue Overview is the existing `/reports` page (currently
  labeled "Revenue Reports"). Refunds (`/refunds`) and Labor (`/labor`) already
  exist under "Operations"; move both here.
- Extras → Private Events (`/private-events`), Gift Cards (`/gift-cards`), and
  Promos (the existing `/promotions` page) all already exist, just regroup.
- Team → Team Access is the existing `/users` page (currently under "Users &
  Permissions"). Recent Activity is the existing `/audit-log` page (currently under
  "Reports & Finance"); move it here. Labor appears a second time here, pointing at
  the same `/labor` page as under Financial Reports — that's intentional, not a
  bug: staff cost matters both as a finance number and as a team-management
  concern, and it's the same underlying page either way.

**Genuinely new, not a rename:**

- **Film Library.** Movie/film management currently lives inside the scheduling
  calendar component (`apps/admin/app/scheduling-calendar.tsx`) — there's no
  standalone page for it. Pulling film management out into its own `Film Library`
  page under Films is real, moderate-sized work, not a nav-only change.
- **POS (under F&B).** Reads as a link out to Staff POS, the same pattern already
  used for the "View customer site ↗" link in `admin-nav.tsx` — not a page inside
  Admin itself. Depends on `docs/STAFF_POS_DEPLOYMENT_AND_LAYOUT.md`'s deployment
  item actually happening first (there's no stable URL to link to yet).
- **Expenses.** No expense tracking exists anywhere in this codebase today —
  checked, nothing in the schema or API. This is a real new feature (schema +
  admin UI), not a nav placement problem. Scope it separately; don't build it as a
  side effect of moving nav items around.
- **Merch (under Extras).** Today "merch" is a single external URL field
  (`content.navigation.merchUrl`) driving a single nav link on the customer site —
  see the separate write-up for what real merch management needs to look like.
- **Memberships (under Extras).** Doesn't exist at all — matches the already-known
  deferred gap (Codex's own status report lists "Membership and charitable-giving
  mechanics" under longer-term, deferred until a real customer/business decision).
  Don't build this as a side effect of the nav restructure; it's still gated on
  that decision.
- **"Tickets" relabel for GA/non-cinema clients.** This depends on the client-type
  work from `docs/ATTEND_MASTER_CLIENT_VERTICAL.md` and the still-deferred
  general-admission ticketing gap — there's no non-cinema client today to test this
  against. Reasonable to build the *conditional label* now (if a client's business
  type isn't a cinema, say "Tickets" instead of "Auditorium & Seats") since the
  classification field already exists, but the underlying GA ticketing system
  itself remains out of scope here.

## Guardrails

- Do the pure regrouping/renaming first — it's cheap, immediately useful, and
  doesn't block on anything.
- Treat Film Library, the POS link, Expenses, and real Merch management as separate,
  independently-sized pieces of work, not bundled into "move some nav items."
- Don't build Memberships or full GA ticketing as part of this — both are called out
  above as intentionally out of scope for the nav change itself.
