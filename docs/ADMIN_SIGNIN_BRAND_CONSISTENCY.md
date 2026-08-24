# Admin Sign-in Branding — Shipped

## Decision

Admin uses Attend's fixed brand before authentication. Client-specific branding
applies only after a staff member establishes a session.

This keeps the sign-in and account-recovery boundary consistent and recognizable,
while preserving each cinema's configured colors and Admin UI preferences inside
the authenticated application.

## Current behavior

`apps/admin/app/admin-session.tsx` implements the split explicitly:

- without a session, branding is `null` and the theme falls back to
  `adminBrandingDefaults` plus `adminUiDefaults`;
- the sign-in surface displays Attend Admin identity and does not use a client's
  logo or color palette;
- the required password-change surface uses the same fixed Attend theme; and
- after authentication, the employee/client branding and public Admin UI settings
  populate the theme variables used by the application.

The fixed palette is defined once in `packages/shared/src/cinema-schemas.ts`; the
Admin session does not duplicate those values.

## Status

The branding consistency decision is complete. Future changes to the sign-in
identity should be treated as a new product decision, not unfinished work from this
brief.
