# Attend Master — Audit Response

An external audit prompt (written for Codex, covering client management, entitlements,
support tooling, impersonation, onboarding, billing, system health, and multi-tenancy)
was checked against the actual current code, not assumed from the prompt's framing.
This doc is the result: what's already real, what's a genuine near-term gap worth a
decision now, and what should explicitly wait. Written up here, not just in chat, so
Codex has one place to work from instead of re-deriving this from a 29-section prompt.

## Already real — confirmed directly against code

Codex has already built most of the structural asks from that audit:

- The Master/Admin boundary itself: separate `PlatformUser` model, separate
  `PlatformAuthGuard` requiring `actorType === "PLATFORM"`, no shared tokens with
  cinema staff (`Employee`) auth.
- Client + location management, onboarding (org + first location + first staff login
  in one flow), branding draft/publish, Content Studio draft/publish.
- Suspension — and it's more thorough than a cosmetic flag. Confirmed in
  `apps/api/src/cinema/cinema.service.ts` and `apps/api/src/auth/guards/jwt-auth.guard.ts`
  (commit `6611eb8`): setting `Organization.active = false` makes every public
  customer-facing endpoint for that org's locations 404 (showtimes, film series,
  dining menu, movie detail, branding, content), and every request from that org's
  staff — not just new logins — is rejected, because `JwtAuthGuard` now checks
  `employee.active && location.active && organization.active` on every request and
  refresh tokens are revoked on suspend. This matches the audit's instinct
  ("don't just do `active = false`") in effect, even though the trigger is a single
  boolean.
- Read-only, time-limited, banner-visible client support sessions, fully audited,
  no refresh token issued — matches the audit's "support impersonation" section
  (§9) essentially point for point.
- A platform-level audit log (`actorType: "PLATFORM"`), tenant-scoped correctly.
- A revenue rollup, dashboard, payments page, client filters, team access with
  password resets.

Don't rebuild any of this. The audit prompt's own instruction ("read the existing
repo before assuming Master is missing") was correct — most of what it asks for
under client management, onboarding, and support sessions already exists.

## Real gaps, worth a decision now

These are small, concrete, and don't depend on having more than one client to matter:

1. **No automated cross-tenant isolation test.** The audit's ask here (§20) is the
   single highest-value item in the whole document and it's currently unverified —
   there's no test in `apps/api/test` that actively tries to fetch another
   organization's data and asserts it's rejected. The tenant-scoping pattern
   (`updateLocation`/`updateOrganization` checking `organizationId` before touching a
   location) looks correct on inspection, but "looks correct on inspection" isn't
   the same as a test that would fail loudly if someone breaks it later. This is
   cheap to add and doesn't wait on anything.
2. **Suspension only has one mode.** Today `active = false` turns everything off at
   once — customer site, staff login, presumably POS/KDS since they ride the same
   `Employee` auth. The audit's point stands: a billing hold, a security incident,
   and a planned offboarding aren't the same situation. Worth deciding — not
   building — whether a second, softer mode (e.g., admin read-only, customer site
   still live) is ever needed, or whether "fully dark" is intentionally the only
   mode Attend wants. Either answer is fine; right now there's no answer on record.
3. **Platform RBAC is two permissions, not a role matrix.** `permissionsForPlatformRole`
   (`apps/api/src/platform/platform-permissions.ts`) only distinguishes `platform:write`
   and `platform:team` across three roles (OWNER/OPERATOR/VIEWER). The audit's
   granular support-tier model (support can resend a ticket but not issue a refund,
   finance can refund but not touch seat maps) doesn't exist. This is genuinely fine
   with a team of one or two — it becomes a real gap the moment a second or third
   Attend employee gets platform access with anything less than full trust. Worth
   noting now so it's not forgotten, not worth building for a team of one.
4. **Platform actions are invisible to the client.** Confirmed: `apps/admin/app/audit-log`
   never queries or renders `actorType: "PLATFORM"` events. If Attend support opens a
   read-only session or a refund gets issued from Master, the cinema client has no way
   to ever see that happened. The audit's §23 question ("should some Attend actions
   appear in the client's own audit log?") hasn't been decided either way — it's not
   that the answer is no, it's that no one has picked. Worth deciding before the first
   real support session happens against a paying client's data, since that's the kind
   of decision that's awkward to make retroactively.

## Explicitly deferred — not gaps, just not needed yet

The audit prompt spends roughly half its length (§12-19, §25-29) on billing/contracts/
CRM, network-wide financial reporting, incident management with external monitoring
integration, feature-flag targeting by cohort/environment, and global cross-order
search. None of this is wrong to want eventually. All of it assumes a business with
several live paying clients generating enough volume and support load to need it.

Attend has one tenant today. Building a billing/invoicing domain model, a
network GMV dashboard, or a feature-flag targeting system now means designing
against zero real usage data — exactly the "design for a hypothetical future
requirement" trap. Revisit this list once there are 3+ live paying clients, not
before. Until then:

- No `Plan`/`Contract`/`Invoice`/`FeatureFlag`/`Entitlement` models.
- No network-level financial reporting or incident/system-health dashboard.
- No global cross-order search beyond what already exists at the single-org level.

## Guardrails

- Item 1 above (cross-tenant test) can be picked up any time — it's pure risk
  reduction with no product decision attached.
- Items 2-4 are decisions to make explicitly, not silent defaults to assume. Flag
  them for a real answer rather than guessing one while building something else.
- Don't start on the deferred list without it being asked for specifically — the
  audit prompt's own framing invites building all 29 sections, and most of the back
  half would be speculative infrastructure for a company with one client.
