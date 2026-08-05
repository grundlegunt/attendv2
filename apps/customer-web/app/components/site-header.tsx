"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="site-brand" href="/showtimes" aria-label="Attend showtimes">
          <span className="eyebrow">ATTEND</span>
          <strong>Cinema</strong>
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
