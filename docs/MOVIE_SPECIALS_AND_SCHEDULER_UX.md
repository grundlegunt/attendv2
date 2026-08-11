# Attend — Movie Specials on Showtimes, and Scheduler Placement Feel

Two small, independent fixes. Written up here so they're durable instructions rather than only existing in chat.

## 1. Movie Specials on the Showtimes page

Confirmed in code: "Movie Specials" already exists and renders correctly on `/dining-bar` (`apps/customer-web/app/dining-bar/page.tsx`), pulling `movieSpecials` from the menu API — but `apps/customer-web/app/showtimes/page.tsx` has no equivalent rendering at all.

- Reuse the same `movieSpecials` data and rendering on `/showtimes`, placed under each movie's showtime listing — matching Nitehawk's pattern of pairing dining specials directly with the schedule itself, not only on a separate page. Don't duplicate the data-fetching logic; reuse what `/dining-bar` already does.
- Also confirmed: there is currently no way to set a menu item's photo from the admin app at all. `MenuItem.imageUrl` already exists in the schema and both public pages already display it when present, but `apps/admin/app/menu/page.tsx` has no image field anywhere. Add one — a plain URL text field, matching the pattern already used for movie posters and film-series artwork elsewhere in the admin app. No file-upload infrastructure exists in this codebase; don't add one here either.

## 2. Scheduler placement feel

Feedback from watching the admin scheduling calendar in real use: the showtime blocks were hard to place precisely, and the remove/duplicate controls visually collided with the block's own title text.

As of the last check, real work already appears to be underway here independently (recent commits: "Improve scheduler interactions and layout," "Fix scheduler swap drop targeting," "Fix scheduler swap time targeting," "Use explicit scheduler swap targets" — and the remove button (`.showtime-quick-remove`) is now hover-only with its own background rather than sitting permanently on top of the title text). That may already resolve this. Before doing more work here:

1. Confirm live, in the actual app, that placing/moving a showtime now feels precise and unambiguous — not just that the commit messages suggest it.
2. If it still doesn't, the concrete symptom to chase is: while dragging, the drop-target preview should be a single, unambiguous highlighted outline — not a state that overlaps or ghosts into a neighboring row's content.
