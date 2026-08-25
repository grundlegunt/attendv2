export type AdminNavItem = {
  href: string;
  label: string;
  permissions: readonly string[];
  permissionMode?: "all" | "any";
  external?: boolean;
};

export type AdminNavGroup = {
  label: string;
  items: readonly AdminNavItem[];
};

const staffPosUrl = (process.env.NEXT_PUBLIC_STAFF_POS_URL?.trim() || "https://attend-staff-pos.vercel.app").replace(/\/$/, "");

export const adminNavigation: readonly AdminNavGroup[] = [
  { label: "Dashboard", items: [
    { href: "/", label: "Dashboard", permissions: [] },
    { href: "/attention", label: "Attention", permissions: ["payment.refund", "reports.view"] },
    { href: "/search", label: "Search", permissions: ["payment.refund"] },
  ] },
  { label: "Films", items: [
    { href: "/scheduling", label: "Schedule", permissions: ["auditorium.manage", "movie.manage", "showtime.manage"] },
    { href: "/films", label: "Film Library", permissions: ["auditorium.manage", "movie.manage", "showtime.manage"] },
    { href: "/film-series", label: "Film Series", permissions: ["auditorium.manage", "movie.manage", "showtime.manage"] },
    { href: "/distributors", label: "Distributors", permissions: ["reports.view.financial"] },
  ] },
  { label: "Setup", items: [
    { href: "/cinema-setup", label: "Auditoriums & Seats", permissions: ["auditorium.manage", "movie.manage", "showtime.manage"] },
    { href: "/branding", label: "Branding", permissions: ["ticket.price.edit"] },
    { href: "/location", label: "Location", permissions: ["ticket.price.edit"] },
    { href: "/taxes", label: "Ticket Prices, Tax & Charges", permissions: ["menu.edit", "ticket.price.edit"], permissionMode: "any" },
  ] },
  { label: "F&B", items: [
    { href: "/menu", label: "Menu", permissions: ["menu.edit"] },
    { href: staffPosUrl, label: "POS", permissions: ["restaurant.order.create", "seat.sell", "ticket.scan"], permissionMode: "any", external: true },
  ] },
  { label: "Financial Reports", items: [
    { href: "/reports", label: "Revenue Overview", permissions: ["reports.view.financial"] },
    { href: "/refunds", label: "Refunds", permissions: ["payment.refund"] },
    { href: "/labor", label: "Labor", permissions: ["reports.view"] },
    { href: "/expenses", label: "Expenses", permissions: ["reports.view.financial"] },
  ] },
  { label: "Extras", items: [
    { href: "/private-events", label: "Private Events", permissions: ["reports.view"] },
    { href: "/gift-cards", label: "Gift Cards", permissions: ["payment.refund"] },
    { href: "/promotions", label: "Promos", permissions: ["ticket.price.edit"] },
  ] },
  { label: "Team", items: [
    { href: "/users", label: "Team Access", permissions: ["employee.edit"] },
    { href: "/labor", label: "Labor", permissions: ["reports.view"] },
    { href: "/audit-log", label: "Recent Activity", permissions: ["audit.log.view"] },
  ] },
] as const;

export function canAccessAdminItem(item: AdminNavItem, permissions: readonly string[]): boolean {
  if (item.permissions.length === 0) return true;
  const granted = new Set(permissions);
  return item.permissionMode === "any"
    ? item.permissions.some((permission) => granted.has(permission))
    : item.permissions.every((permission) => granted.has(permission));
}

export function visibleAdminNavigation(permissions: readonly string[]): AdminNavGroup[] {
  return adminNavigation
    .map((group) => ({ ...group, items: group.items.filter((item) => canAccessAdminItem(item, permissions)) }))
    .filter((group) => group.items.length > 0);
}

export function isAdminItemActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
