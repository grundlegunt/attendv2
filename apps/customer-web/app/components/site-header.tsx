"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useCinemaContent, useCustomerBranding } from "./customer-branding";

const links = [
  { href: "/showtimes", label: "Showtimes" },
  { href: "/coming-soon", label: "Coming Soon" },
  { href: "/coming-soon?view=JUST_ANNOUNCED", label: "Just Announced" },
  { href: "/film-series", label: "Film Series" },
  { href: "/showtimes?presentation=OPEN_CAPTIONS", label: "Open Captions" },
  { href: "/dining-bar", label: "Dining & Bar" },
  { href: "/account", label: "Account" },
  { href: "/about", label: "About" },
  { href: "/directions", label: "Directions" },
  { href: "/private-events", label: "Private Events" },
  { href: "/gift-cards", label: "Gift Cards" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const branding = useCustomerBranding();
  const content = useCinemaContent();
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => setLogoFailed(false), [branding.logoUrl]);

  const showLogo = Boolean(branding.logoUrl) && !logoFailed;

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="site-brand" href="/showtimes" aria-label={`${branding.name} showtimes`}>
          {showLogo ? (
            <img src={branding.logoUrl ?? undefined} alt={branding.name} onError={() => setLogoFailed(true)} />
          ) : (
            <strong>{branding.name}</strong>
          )}
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
          {content.navigation.merchUrl && (
            <a href={content.navigation.merchUrl} target="_blank" rel="noreferrer">Merch ↗</a>
          )}
        </nav>
      </div>
    </header>
  );
}
