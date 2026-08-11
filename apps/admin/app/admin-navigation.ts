export type AdminNavItem = {
  href: string;
  label: string;
  permissions: readonly string[];
  permissionMode?: "all" | "any";
};

export type AdminNavGroup = {
  label: string;
  items: readonly AdminNavItem[];
};

export const adminNavigation: readonly AdminNavGroup[] = [
  { label: "Overview", items: [{ href: "/", label: "Dashboard", permissions: [] }] },
  { label: "Films", items: [
    { href: "/scheduling", label: "Schedule", permissions: ["auditorium.manage", "movie.manage", "showtime.manage"] },
    { href: "/film-series", label: "Film Series", permissions: ["auditorium.manage", "movie.manage", "showtime.manage"] },
  ] },
  { label: "Cinema Setup", items: [
    { href: "/cinema-setup", label: "Auditoriums & Seats", permissions: ["auditorium.manage", "movie.manage", "showtime.manage"] },
    { href: "/branding", label: "Brand Status", permissions: ["ticket.price.edit"] },
    { href: "/location", label: "Location", permissions: ["ticket.price.edit"] },
  ] },
  { label: "Operations", items: [
    { href: "/private-events", label: "Private Events", permissions: ["reports.view"] },
    { href: "/menu", label: "Menu", permissions: ["menu.edit"] },
    { href: "/refunds", label: "Refunds", permissions: ["payment.refund"] },
    { href: "/labor", label: "Labor", permissions: ["reports.view"] },
  ] },
  { label: "Reports & Finance", items: [
    { href: "/reports", label: "Revenue Reports", permissions: ["reports.view.financial"] },
    { href: "/gift-cards", label: "Gift Cards", permissions: ["payment.refund"] },
    { href: "/audit-log", label: "Recent Activity", permissions: ["audit.log.view"] },
  ] },
  { label: "Users & Permissions", items: [
    { href: "/users", label: "Team Access", permissions: ["employee.edit"] },
  ] },
  { label: "Settings", items: [
    { href: "/promotions", label: "Promotions", permissions: ["ticket.price.edit"] },
    { href: "/taxes", label: "Ticket Prices, Tax & Charges", permissions: ["menu.edit", "ticket.price.edit"], permissionMode: "any" },
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
