# Attend — Staff POS: Real Deployment, and a Tile-Grid Menu Layout

Two independent pieces of work on `apps/staff-pos` (and `apps/kds` where noted).
Written up separately below — don't let one block the other.

## 1. Deploy Staff POS (and KDS) to Vercel

Confirmed directly: `apps/staff-pos` and `apps/kds` have never been deployed. Only
three Vercel projects exist today — `attendv2` (customer-web), `attendv2-admin`,
and `attend-master` (platform-admin) — confirmed via `gh pr checks` on a recent PR,
which only lists those three `Vercel – *` status checks. Both apps only run as local
dev servers (`next dev -p 3001` / `-p 3002`) today, with no production URL.

That's not a viable way to actually run this at a real theater — physical POS
terminals and kitchen-display screens shouldn't need Node.js installed and a dev
server manually kept running and updated on each one. The right model is the same
one already used for `admin`, `customer-web`, and `attend-master`: deploy to a real
URL, and each physical terminal is just a browser (or a kiosk-mode browser) pointed
at it. Push once, every terminal gets the update — no per-device deploys.

**What to do:**

- Create two new Vercel projects, same pattern as the existing three: root directory
  `apps/staff-pos` and `apps/kds` respectively, connected to this repo, auto-deploying
  from `main` the same way the other three do. There's no `vercel.json` anywhere in
  this repo for any app — deployment config lives in the Vercel project settings
  themselves (dashboard or `vercel` CLI), not in-repo. If Codex doesn't have Vercel
  account/API access to create projects directly, this step needs the account owner
  (Joe) to do it in the Vercel dashboard — flag that rather than guessing at
  API tokens.
- Set `NEXT_PUBLIC_API_URL` on both new projects to the production API's real URL
  (same value already configured for `attendv2-admin`'s production environment —
  reuse it, don't guess at a new one).
- Add both new production URLs to the API's `CORS_ORIGINS` — today
  `apps/api/.env.example` only lists localhost origins
  (`http://localhost:3000` through `:3003`); the real production API's actual
  `CORS_ORIGINS` (wherever it's configured — Railway per the existing deployment
  setup) needs the two new production URLs added, or requests from them will be
  rejected.
- No code changes needed beyond that — `apps/staff-pos` and `apps/kds` already build
  and run the same way the other three apps do (`transpilePackages`,
  `reactStrictMode`, standard Next.js config, nothing app-specific blocking a normal
  Vercel deploy).

**Access control:** don't restrict this by network/IP or treat it as needing to be
"hidden." The existing staff login (email/password, then a PIN for the shared-terminal
time clock) is the real security boundary, exactly like Admin — a Vercel URL that
isn't linked anywhere public is not more secure than that, and trying to make it so
adds real complexity for no real benefit at this stage.

## 2. Server POS menu layout — tile grid, not a long scroll

Direct feedback after seeing the current Server POS screen live: it's a single long
vertical page — every category (Food, Shareables, Salads, Toasties, Sweet Treats,
Cocktails, Natural Wine, Beer, Non-Alcoholic, Soda/Coffee/Tea, Movie Specials) stacked
top to bottom, each item as a full-width card with its full description and any
modifiers always visible. Reaching Movie Specials today means scrolling through the
entire wine list first. Reference for the target feel: Veezi's POS screen (a real
competitor, see `docs/VEEZI_FEATURE_COMPARISON.md`) — a dense grid of square item
tiles (icon or short label + price, no long description), category tabs along the
bottom to switch which grid is showing, and a persistent ticket/total panel on the
side rather than only at the top of a long page.

**Current implementation**: `apps/staff-pos/app/restaurant-pos.tsx` (831 lines) —
`addItem`, `sendOrder`, and the modifier-selection logic (`modifierSelections` state,
keyed by `${item.id}:${group.id}`) are the real logic to preserve; this is a layout
change on top of working logic, not a rewrite of the ordering flow itself.

**What to change:**

- Replace the single stacked-category page with **category tabs** (Food, Shareables,
  Salads, Toasties, Sweet Treats, Cocktails, Natural Wine, Beer, Non-Alcoholic,
  Soda/Coffee/Tea, Movie Specials — the existing menu categories, unchanged) so only
  one category's items render at a time. No category should ever require scrolling
  past unrelated categories to reach.
- Replace full-width description cards with a **compact tile grid** — item name and
  price always visible, full description available on demand (tap/expand) rather
  than always rendered inline. This is the main reason the page is currently so long.
- **Modifiers** (like the Cheeseburger's required Temperature choice) shouldn't
  permanently expand a tile's height in the grid — move modifier selection to a
  small popup/expansion triggered by tapping the tile, so tiles the server isn't
  currently ordering stay small and the grid stays dense.
- Keep the **running check/ticket total** visible while browsing the menu — today it
  only shows at the top of the page, which scrolls out of view. A persistent side
  panel (or a sticky summary bar) showing the open check, its running total, and
  what's already been added addresses this — servers shouldn't need to scroll back
  to the top to see what they've already rung up.

**Guardrails:**

- This is a layout/interaction change, not a menu-data change — don't touch category
  names, item names/prices/descriptions, or which items route to Kitchen vs. Bar.
- Don't drop the required-modifier enforcement (confirmed working today — the
  Cheeseburger's "Add item" is correctly disabled until Temperature is chosen) while
  restructuring how modifiers are presented.
- Section 1 (deployment) and Section 2 (layout) don't depend on each other and can
  be picked up in either order or in parallel.
