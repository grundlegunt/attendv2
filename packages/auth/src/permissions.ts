/**
 * The permission catalog is a fixed, code-defined list — never editable
 * through any admin UI or database write outside a migration/seed. This is
 * a deliberate anti-privilege-escalation choice. See:
 *   /docs/SECURITY.md §2, /docs/AGENTS.md §5, /docs/OPEN_QUESTIONS.md §5.
 *
 * Adding a new permission is a two-step change, always together:
 *   1. Add the key here (and a row will be created for it by the database
 *      seed / a future "sync permissions" migration step).
 *   2. Wire it into the role matrix below and use it in a guard.
 *
 * Naming convention: `<domain>.<action>[.<qualifier>]`.
 *
 * NOTE ON SCOPE: only a subset of these permissions have any enforcement
 * code behind them as of Milestone 0 (employee/audit management, seen in
 * apps/api's auth module). The rest are defined now because the full
 * catalog is stable domain knowledge from /docs/SECURITY.md's role matrix,
 * and defining the constant early means later milestones extend a matrix
 * instead of inventing one under time pressure. Do not build UI or API
 * surface that *implies* a permission is enforced before the guard for it
 * actually exists — see AGENTS.md §2 ("never fake it").
 */
export enum Permission {
  // --- Employee / RBAC management (enforced starting Milestone 0) ---
  EmployeeCreate = "employee.create",
  EmployeeEdit = "employee.edit",
  EmployeePermissionsEdit = "employee.permissions.edit",

  // --- Audit (enforced starting Milestone 0) ---
  AuditLogView = "audit.log.view",

  // --- Seating / ticketing (Milestone 1-4) ---
  AuditoriumManage = "auditorium.manage",
  MovieManage = "movie.manage",
  ShowtimeManage = "showtime.manage",
  SeatSell = "seat.sell",
  SeatBlock = "seat.block",
  SeatHold = "seat.hold",
  TicketPriceEdit = "ticket.price.edit",
  TicketRefund = "ticket.refund",
  TicketScan = "ticket.scan",

  // --- Restaurant / POS (Milestone 5-8) ---
  RestaurantOrderCreate = "restaurant.order.create",
  RestaurantOrderTransfer = "restaurant.order.transfer",
  RestaurantItemVoid = "restaurant.item.void",
  RestaurantItemComp = "restaurant.item.comp",
  KitchenStatusUpdate = "kitchen.status.update",
  MenuEdit = "menu.edit",

  // --- Payments (Milestone 3, 8) ---
  PaymentRefund = "payment.refund",
  PaymentViewDisplaySafe = "payment.view.display_safe", // brand/last4 only, never raw data

  // --- Reporting / finance (Milestone 10) ---
  ReportsView = "reports.view",
  ReportsViewFinancial = "reports.view.financial",
}

/**
 * The fixed set of staff roles, matching /docs/SECURITY.md §2.1 and
 * /docs/PRODUCT_SPEC.md §3. Role *names* can vary per organization (stored
 * in the `roles` table), but this key is what permission mappings and
 * guards key off — never the display name.
 */
export enum RoleKey {
  Owner = "OWNER",
  GeneralManager = "GENERAL_MANAGER",
  CinemaManager = "CINEMA_MANAGER",
  RestaurantManager = "RESTAURANT_MANAGER",
  BoxOffice = "BOX_OFFICE",
  Server = "SERVER",
  Bartender = "BARTENDER",
  Kitchen = "KITCHEN",
  Runner = "RUNNER",
  Door = "DOOR",
  Accounting = "ACCOUNTING",
  Support = "SUPPORT",
}

/** Roles required to have MFA enabled per /docs/SECURITY.md §1. */
export const MFA_REQUIRED_ROLES: ReadonlySet<RoleKey> = new Set([
  RoleKey.Owner,
  RoleKey.GeneralManager,
  RoleKey.Accounting,
]);

/**
 * Default role -> permission matrix, seeded for every new organization.
 * Mirrors the illustrative table in /docs/SECURITY.md §2.1, extended to be
 * concrete/complete since the seed script needs real data, not an example.
 *
 * OWNER and GENERAL_MANAGER receive every defined permission; other roles
 * are deliberately scoped down. This is seed *data*, not hardcoded
 * authorization logic — an organization's actual `RolePermission` rows can
 * diverge from this default later via the (future) role administration
 * screens, but the *set of assignable permissions* can never exceed this
 * module's enum.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  [RoleKey.Owner]: Object.values(Permission),
  [RoleKey.GeneralManager]: Object.values(Permission),

  [RoleKey.CinemaManager]: [
    Permission.AuditoriumManage,
    Permission.MovieManage,
    Permission.ShowtimeManage,
    Permission.SeatSell,
    Permission.SeatBlock,
    Permission.SeatHold,
    Permission.TicketPriceEdit,
    Permission.TicketRefund,
    Permission.TicketScan,
    Permission.PaymentRefund,
    Permission.PaymentViewDisplaySafe,
    Permission.ReportsView,
    Permission.AuditLogView,
  ],

  [RoleKey.RestaurantManager]: [
    Permission.MenuEdit,
    Permission.RestaurantOrderCreate,
    Permission.RestaurantOrderTransfer,
    Permission.RestaurantItemVoid,
    Permission.RestaurantItemComp,
    Permission.PaymentRefund,
    Permission.PaymentViewDisplaySafe,
    Permission.ReportsView,
    Permission.AuditLogView,
  ],

  [RoleKey.BoxOffice]: [
    Permission.SeatSell,
    Permission.SeatHold,
    Permission.SeatBlock,
    Permission.TicketScan,
    Permission.TicketRefund, // full refunds only, per MVP policy — see PAYMENT_FLOW.md §7
    Permission.PaymentViewDisplaySafe,
  ],

  [RoleKey.Server]: [
    Permission.RestaurantOrderCreate,
    Permission.RestaurantOrderTransfer,
    Permission.SeatHold,
    Permission.PaymentViewDisplaySafe,
  ],

  [RoleKey.Bartender]: [
    Permission.RestaurantOrderCreate,
    Permission.KitchenStatusUpdate,
    Permission.PaymentViewDisplaySafe,
  ],

  [RoleKey.Kitchen]: [Permission.KitchenStatusUpdate],
  [RoleKey.Runner]: [Permission.KitchenStatusUpdate],

  [RoleKey.Door]: [Permission.TicketScan],

  [RoleKey.Accounting]: [
    Permission.ReportsView,
    Permission.ReportsViewFinancial,
    Permission.PaymentRefund,
    Permission.AuditLogView,
  ],

  [RoleKey.Support]: [Permission.AuditLogView],
};
