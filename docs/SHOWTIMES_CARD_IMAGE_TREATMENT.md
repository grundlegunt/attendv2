# Showtimes Page — Card Image Treatment, and Settling the Column Question

## The column question is settled: 3 stays

The 2-vs-3-column question has flip-flopped once already (built as 2, reverted to 3
the same night — PR #447 then #455, never actually explained at the time). Direct
side-by-side comparison against Nitehawk's live site now: **3 columns stays.** The
2-column version was tried and didn't look right. Don't revisit this again without
a new, explicit ask — it's cost real back-and-forth once already.

## The actual issue: image aspect ratio, not column count

Comparing Attend's current showtimes page against nitehawkcinema.com side by side,
the real difference isn't layout, it's the movie card images themselves. Nitehawk's
images read as tall, substantial, cinematic scene stills. Attend's read as short,
wide thumbnails — cropped, correctly, just into the wrong shape.

Found the exact cause: `apps/customer-web/app/globals.css`, `.program-tile__image`
is fixed at `aspect-ratio: 4 / 3` — a short landscape ratio. That fixed container
shape is what's actually driving the "thumbnail" feel, independent of whatever
image an admin picks or how it's framed.

**This isn't a missing-feature problem** — the admin-side crop/framing controls
already exist and work (`movieArtworkObjectPosition`, wired into both
`apps/customer-web/app/components/movie-tile.tsx` and the scheduling page,
shipped a few days ago). The fixed `4/3` container is overriding whatever framing
an admin sets, capping how much presence any image can have regardless of how
well it's cropped.

**What to change**: give `.program-tile__image` a taller aspect ratio — closer to
what Nitehawk's cards actually look like (noticeably taller than 4:3, though not a
full portrait poster ratio either — somewhere between the two, matching how their
scene-still images fill the card with real vertical presence). Since this is a
visual judgment call rather than an exact number that can be read off a
screenshot, iterate against the live Nitehawk reference rather than guessing a
precise ratio up front.

## Guardrails

- Don't touch the column count — that part is decided.
- Don't rebuild the framing/crop-position system — it already exists and works.
  This is purely the fixed container aspect ratio it's constrained by.
- Keep Attend's own serif title treatment on the card overlay (Playfair Display,
  matching the established brand identity) — don't copy Nitehawk's bold
  condensed-sans title style along with the image sizing. The image proportions
  are the actual ask here, not a full visual clone of Nitehawk's card design.
