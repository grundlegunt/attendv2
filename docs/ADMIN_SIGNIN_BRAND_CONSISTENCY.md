# Attend Admin — Sign-in Page Branding

## The decision

The Admin sign-in page (before a staff member authenticates) should use Attend's own
consistent brand colors, the same identity Attend Master uses — not the signed-in
client's customized color scheme. Once a staff member successfully logs in, their
organization's own color scheme (set via Master's branding tool) takes over for the
rest of the Admin interface as it does today.

This resolves an ambiguity `docs/POST_MILESTONE_EDIT_LIST.md` explicitly flagged and
left open ("a standard sign-in page... or... match the client's color scheme — needs
a decision"). Decision made: standard Attend brand pre-login, client brand post-login.

## What's actually there right now

Checked directly against `apps/admin/app/admin-session.tsx` (commit `8d25679`,
"Polish branded admin sign-in"): the sign-in screen currently pulls the client's own
`publicAdminBranding` — their `accentColor`, `backgroundColor`, `surfaceColor`,
`textColor`, and `logoUrl` — and applies it as the theme (`--color-*` CSS variables
on `.admin-theme-root`) before the staff member has authenticated. That's the
opposite of what's wanted here: it makes the sign-in page look different per client
instead of being a consistent, recognizable Attend surface.

## What to change

- Render the sign-in screen (the `!value` branch in `admin-session.tsx`, and the
  password-change/MFA branches that can also appear before a session exists) using a
  **fixed Attend brand palette** instead of `publicAdminBranding`'s per-client colors.
  `adminUiDefaults` (`packages/shared/src/cinema-schemas.ts`) is the existing
  fallback palette and a reasonable starting point if there isn't already a defined
  "Attend brand" constant elsewhere — check for one before introducing a second
  source of truth for the same colors.
- Once `login()` succeeds and a `Session` exists, switch to applying the client's own
  `publicAdminBranding`/`adminUi` theme as it already does for the rest of Admin —
  that part of the existing behavior is correct and shouldn't change.
- Client name and logo on the sign-in screen: not explicitly decided here. Keeping
  the client's name/logo while using Attend's own colors is a reasonable middle
  ground (confirms staff are signing into the right client without theming the whole
  page around them), but confirm this rather than assuming — the ask was specifically
  about color scheme consistency, not about removing all client identity from the
  screen.

## Guardrails

- Don't touch how branding applies after authentication — this is scoped to the
  pre-login screen only.
- Don't invent a new "Attend brand color" constant if one already exists somewhere in
  the codebase (Master's own UI, `apps/customer-web`'s default theme, etc.) — reuse
  it rather than defining Attend's brand colors a second time.
