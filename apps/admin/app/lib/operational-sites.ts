export type OperationalSite = {
  href: string;
  label: string;
  permissions: readonly string[];
};

function siteUrl(value: string | undefined, fallback: string): string {
  return (value?.trim() || fallback).replace(/\/$/, "");
}

export const operationalSites: readonly OperationalSite[] = [
  {
    href: siteUrl(process.env.NEXT_PUBLIC_STAFF_POS_URL, "https://attend-staff-pos.vercel.app"),
    label: "Open Staff POS",
    permissions: ["restaurant.order.create", "seat.sell", "ticket.scan"],
  },
  {
    href: siteUrl(process.env.NEXT_PUBLIC_KDS_URL, "https://attendv2-kds.vercel.app"),
    label: "Open kitchen display",
    permissions: ["kitchen.status.update"],
  },
] as const;

export function visibleOperationalSites(permissions: readonly string[]): OperationalSite[] {
  const granted = new Set(permissions);
  return operationalSites.filter((site) => site.permissions.some((permission) => granted.has(permission)));
}
