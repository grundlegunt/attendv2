"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCustomerBranding } from "./customer-branding";

const links = [
  { href: "/showtimes", label: "Showtimes" },
  { href: "/coming-soon", label: "Coming Soon" },
  { href: "/film-series", label: "Film Series" },
  { href: "/account", label: "Account" },
  { href: "/directions", label: "Directions" },
  { href: "/private-events", label: "Private Events" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { branding } = useCustomerBranding();

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="site-brand" href="/showtimes" aria-label={`${branding.displayName} showtimes`}>
          {branding.logoUrl ? <img src={branding.logoUrl} alt={branding.displayName} /> : <><span className="eyebrow">{branding.eyebrow}</span><strong>{branding.displayName}</strong></>}
        </Link>
        <nav className="site-nav" aria-label="Customer navigation">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={pathname === link.href ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
