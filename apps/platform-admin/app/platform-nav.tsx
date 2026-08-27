"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["/", "Dashboard"], ["/clients", "Clients"], ["/benchmarks", "Benchmarks"],
  ["/films", "Films"], ["/distributors", "Distributors"], ["/analytics", "Audience"],
  ["/onboarding", "Onboarding"], ["/payments", "Payments"], ["/operations", "Operations"],
  ["/content", "Content"], ["/branding", "Branding"], ["/team", "Team"],
  ["/audit", "Audit Log"], ["/diagnostics", "Diagnostics"],
] as const;

export function PlatformNav({ role }: { role: "OWNER" | "OPERATOR" | "VIEWER" }) {
  const pathname = usePathname();
  return <nav className="platform-nav" aria-label="Ringo Master">{links.filter(([href]) => href !== "/team" || role === "OWNER").map(([href, label]) => {
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    return <Link className={active ? "active" : undefined} href={href} key={href}>{label}</Link>;
  })}</nav>;
}
