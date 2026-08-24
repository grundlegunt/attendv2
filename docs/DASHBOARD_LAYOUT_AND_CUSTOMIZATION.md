# Admin Dashboard — Close the Quick Actions Gap, Add Customization

## Still open: Quick Actions placement

Flagged before (`docs/ADMIN_DASHBOARD_SHOWTIME_DETAIL.md`), confirmed still
unaddressed via fresh screenshot: the "Cinema setup / Readiness" card ends with
"Time clock enabled · Ticket tax 9.75%" and then leaves a large empty gap before
Quick Actions appears, well below, near Audit Trail. Move Quick Actions directly
under Cinema Setup in the right column — no reason for the empty space between
them.

## New: make the dashboard customizable per operator

Checked `apps/admin/app/admin-dashboard.tsx` (351 lines) — today's dashboard is a
fixed set of widgets (Today's Schedule, Ticket Face Value, F&B Revenue, Film
Series count, Top Performing Films, Programming/Schedule, Cinema Setup readiness,
Audit Trail, Quick Actions), permission-gated but not customizable — every
operator with the same permissions sees the identical layout.

Add real customization: let an operator choose which widgets appear and in what
order. This is a per-user preference (a general manager, a shift lead, and a box
office lead plausibly want different things front and center), not a per-location
setting — store it against the signed-in employee, not the location/org.

## Guardrails

- Keep this scoped to layout/visibility of existing widgets — don't turn this
  into "build new dashboard widgets" as part of the same task. Customization
  applies to what's already there.
- Permission gating stays exactly as it is (`canCinema`, `canFinancial`, etc.) —
  customization only affects ordering/visibility among widgets an operator
  already has permission to see, it doesn't grant access to anything new.
