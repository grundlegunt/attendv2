# Attend — A Regression and Two Still-Undone Doc PRs

Found while auditing recently merged work against what was actually asked for.
Written up because both are real, not because they're urgent — one is a fix, one
is a "this doc landed but nothing acted on it yet."

## 1. Sign-in branding: reported fixed, isn't

PR #464 ("Admin sign-in: Attend brand pre-login, client brand post-login") is
merged and its title claims to resolve `docs/ADMIN_SIGNIN_BRAND_CONSISTENCY.md`.
It doesn't. Checked `apps/admin/app/admin-session.tsx` directly, current `main`:

```
const branding = value?.employee.adminBranding ?? publicBranding;
```

When there's no session yet (`value` is null, i.e. the sign-in screen), `branding`
falls back to `publicBranding` — the signed-out client's own branding, fetched from
the public API — not a fixed Attend palette. The theme object built from `branding`
(accent/background/surface/text colors) and the logo/name shown on the login screen
(`publicBranding?.logoUrl`, `publicBranding?.name`) are both still client-specific.
This is exactly the behavior the original doc asked to change, still present.

**What actually needs to happen**, restated from the original doc since the first
attempt didn't land it: the sign-in screen (`!value` branch and any other
pre-authentication branch in `admin-session.tsx`) should use a fixed Attend brand
palette, not `publicBranding`. Only switch to the client's own branding once
`value` (an authenticated session) exists.

## 2. Staff POS deployment + layout — doc merged, nothing built yet

PR #470 ("Staff POS: deploy to Vercel, tile-grid menu layout") merged
`docs/STAFF_POS_DEPLOYMENT_AND_LAYOUT.md` itself, but neither item in it has been
started:

- No `vercel.json` or new Vercel project for `apps/staff-pos` or `apps/kds` —
  still local-dev-only, same as before the doc was written.
- `apps/staff-pos/app/restaurant-pos.tsx` has no category tabs, no tile grid — still
  the same long single-scroll page.

Not a regression, just a doc that hasn't been picked up yet. Restating it here so
it's not assumed done just because the PR that introduced it is merged — the doc
being merged and the work being done are two different things, and the sign-in item
above is a good example of why that distinction matters.

## Guardrails

- Before marking either of these "done" again, verify against the actual code
  (`admin-session.tsx`'s `branding`/`theme` construction for #1; `vercel.json`
  existence and `restaurant-pos.tsx`'s markup for #2) — not just the presence of a
  merged PR with a matching title.
