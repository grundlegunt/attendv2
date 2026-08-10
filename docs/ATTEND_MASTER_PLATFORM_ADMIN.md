# Attend Master — Platform Administration

## The three-tier architecture

Attend now has three distinct applications, each for a different audience. This is the confirmed, current reality — write it down so future work doesn't blur the boundaries:

- **`apps/customer-web`** — for **customers**. Buying tickets, browsing film series, ordering food, managing their account.
- **`apps/admin`** — for **a specific theater's own staff**. Scheduling, menu management, refunds, reporting, labor, taxes, promotions — everything one cinema client needs to run its own location(s). Scoped entirely to that organization; staff never see other clients.
- **`apps/platform-admin` ("Attend Master")** — for **Attend's own company/owner**. Onboarding new theater clients onto the platform and managing their setup. Not accessible to cinema staff or customers — separate login, separate auth boundary (`PlatformAuthGuard` requires `actorType === "PLATFORM"`, a completely different token type from cinema staff `Employee` auth).

## What Attend Master already does

Verified directly against `apps/api/src/platform/platform.service.ts` and `apps/platform-admin/app/page.tsx`:

- **Separate login** — `PlatformUser` is its own model (name, email, password hash, active flag), entirely distinct from `Employee`.
- **Cross-client overview** — lists every organization and its locations, with operational counts (auditoriums, employees, menu items, upcoming showtimes) and a payments status badge per organization.
- **Client onboarding** — creates a new `Organization` (theater company/chain) together with its first `Location` in one step. More locations can be added to an existing client afterward.
- **Edit organization identity** — name, legal name, timezone, and the Stripe Connect onboarding status label.
- **Edit location identity and operations** — name, address, timezone, active flag, plus the operational settings (ticket tax rate, pre-show/cleaning buffers, check-drop timing, time-clock toggle) that were previously only reachable from inside that client's own admin app.
- **Branding** — stages each client's customer-facing and admin-facing color palette, logo, and admin UI settings as a private draft with an explicit preview-and-publish step before either live experience changes.
- **Content Studio** — a real draft → publish workflow (`contentDraft`/`contentPublished`/`contentPublishedAt` on `Location`) for editing the About, Afterglow, Dining & Bar, and Private Events page copy, without a code deploy.
- **Create the client's first staff login** — `POST .../cinema-manager` creates the first cinema-admin employee account for a newly onboarded location, so the client can actually get into their own `apps/admin` after Attend Master sets them up. (This closes part of what used to be a real onboarding gap — a client previously had no way to ever log into their own admin app at all.)
- **Suspend or reactivate a client** — an organization-level status pauses customer discovery and all cinema-staff access across every location without overwriting the individual locations' active/inactive settings. Suspension revokes staff refresh sessions and is enforced against existing access tokens.
- **Read-only client support sessions** — authorized Attend operators can open one active cinema location for 15 minutes without asking for client credentials. The session is visibly bannered, cannot make non-read API requests, carries no refresh token, and records its creation in the platform audit trail.
- **Audit trail** — every platform action (login, org created/updated, location updated, content draft/publish) is written as an `actorType: "PLATFORM"` audit event, tenant-isolation-scoped correctly (`updateLocation`/`updateOrganization` both verify the location actually belongs to the given `organizationId` before touching it — matches the existing cross-tenant isolation discipline from `docs/SECURITY.md` §2.2).

This is real, working infrastructure, not a stub — the tenant-isolation and audit discipline already established elsewhere in the codebase carried over correctly.

## What's missing

Checked against the actual code, not assumed. Ranked by how much each one blocks the platform actually functioning as a business:

### Blocking — the core onboarding promise isn't actually deliverable yet

**There is no real Stripe Connect onboarding flow.** Grepped the whole codebase: `Organization.stripeConnectedAccountId` is read everywhere payments happen (box office, refunds, restaurant settlement) but is never *written* anywhere outside a migration. There's no endpoint that creates a Stripe Connect account for a new client or generates the account-onboarding link Stripe requires. `updateOrganization` will refuse to mark onboarding `COMPLETE` unless `stripeConnectedAccountId` is already set — which is the right guard, but nothing in the product can ever set that field in the first place. Today, a newly onboarded client can never actually start accepting real payments through Attend Master; the "payments connected" status can only be artificially true if someone sets it by hand in the database. This is the single most important gap — it blocks the entire "onboard a new client" value proposition, not just a nice-to-have.

### High priority

- **No platform-user management.** `PlatformUser` has no create/list/manage endpoints at all — only `/auth/login` exists. Whoever is already a row in that table can use Attend Master; there's no way to invite a co-worker, and no roles (every platform user has identical, full access to every client — no read-only or scoped access exists). If Attend ever has more than one person running the company side, this needs to exist.
- **No password reset for platform users**, same gap already flagged for cinema `Employee` accounts in `docs/ADMIN_APP_STRUCTURE.md` — worth fixing in both places together rather than twice.
- **No audit log viewer inside Attend Master.** The audit trail is being written correctly (see above) but there's no route or screen to read it back. Right now that data is only inspectable via direct database access.

### Worth deciding on, not urgent

- **No cross-client revenue or usage rollup.** The overview shows operational counts (auditoriums, employees, menu items, showtimes) but nothing about actual ticket or F&B revenue per client. For a company running a multi-tenant SaaS, this is normally the first thing you'd want to see — both for business health monitoring and because it's the natural basis for a take-rate or usage-based billing model.
- **There is no billing/subscription model in the schema at all** — no concept of what Attend charges a client (flat SaaS fee? percentage of transactions? something else). This doesn't need to be built yet, but it's worth being a deliberate decision rather than something that gets bolted on later once clients are already live.

## Proposed full layout

Attend Master today is one page (`apps/platform-admin/app/page.tsx`) doing everything — overview, org create, org edit, location edit, content draft/publish, all in one component. That was fine to get real functionality shipped, but it should split the same way `apps/admin` already did (see `docs/ADMIN_APP_STRUCTURE.md`): one route per concern, not one page doing everything. Proposed page list:

- **Dashboard** — the landing page after login. Cross-client KPIs, not per-client detail: total clients, total locations, how many clients are stuck at each Stripe onboarding stage, recently onboarded clients, and (once the revenue rollup below exists) aggregate ticket/F&B revenue across the whole platform for today/this week. This is the "is the business healthy" screen — right now Attend Master has no such view at all, only a flat client list.
- **Clients** — the existing organization list/detail, promoted to its own route. Add a search/filter (by onboarding status, active/inactive, location count) to the list once there are more than a handful of clients — a flat list doesn't scale.
- **Onboarding** — turn the current single flat "create organization" form into an actual guided sequence: org info → first location → Stripe Connect → branding → content defaults → create first staff login → review and launch. Not because the current form is wrong, but because a real wizard lets Attend Master show *where* a client is stuck (e.g., "onboarded but never finished Stripe") instead of only an end-state form.
- **Payments** — a dedicated screen for the Stripe Connect side specifically, separate from general org editing: which clients are connected, which are mid-onboarding, and (once built) the actual "start/resume Stripe Connect onboarding" action. This is where the blocking gap below gets a home once it's built.
- **Content Studio** — already its own real workflow, keep as-is, just give it a permanent nav entry instead of being embedded inside the client-detail view.
- **Branding** — same; give it its own screen, and add the draft/preview step called out below.
- **Team** — manage Attend Master's own users once that exists (see below): invite, deactivate, assign a role.
- **Audit Log** — once a viewer exists (see below), a dedicated screen to search/filter the platform-level audit trail: by client, by actor, by action, by date range.

None of this needs to happen at once — it's the target shape to grow into, not a rewrite request. The Stripe Connect flow and the page split are the two structural things worth doing first; the rest can follow incrementally.

## Guardrails

- Preserve the existing tenant-isolation pattern exactly — every `platform.service.ts` mutation already correctly scopes by `organizationId` before touching a location; don't loosen that while adding new endpoints.
- Don't invent a billing/subscription model on your own — that's a real product/business decision, not something to infer from the schema being empty.
- Keep the platform auth boundary (`PlatformAuthGuard`, `actorType === "PLATFORM"`) completely separate from cinema staff auth — no shared tokens, no endpoint reachable by both actor types.
- The Stripe Connect onboarding flow is the priority item here — everything else in this doc can wait, that one blocks the platform's actual purpose.
