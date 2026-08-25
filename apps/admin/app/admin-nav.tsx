"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAdminSession } from "./admin-session";
import { isAdminItemActive, visibleAdminNavigation } from "./admin-navigation";
import { CUSTOMER_WEB_URL } from "./lib/customer-site";
import { visibleOperationalSites } from "./lib/operational-sites";

export function AdminNav() {
  const pathname = usePathname();
  const { employee, signOut } = useAdminSession();
  const groups = useMemo(() => visibleAdminNavigation(employee.permissions), [employee.permissions]);
  const operationalSites = useMemo(() => visibleOperationalSites(employee.permissions), [employee.permissions]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);

  useEffect(() => { setMobileOpen(false); }, [pathname]);
  useEffect(() => { setSidebarCollapsed(window.localStorage.getItem("attend-admin-sidebar") === "collapsed"); }, []);

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("attend-admin-sidebar", next ? "collapsed" : "expanded");
      return next;
    });
  }

  function toggleGroup(label: string) {
    setCollapsedGroups((current) => current.includes(label) ? current.filter((item) => item !== label) : [...current, label]);
  }

  return <>
    <header className="admin-mobile-bar">
      <Link href="/" className="admin-brand"><span>ATTEND</span><strong>Admin</strong></Link>
      <button type="button" className="admin-menu-toggle" aria-expanded={mobileOpen} aria-controls="admin-sidebar" onClick={() => setMobileOpen((open) => !open)}>
        <span aria-hidden="true">☰</span><span>{mobileOpen ? "Close" : "Menu"}</span>
      </button>
    </header>
    {mobileOpen && <button type="button" className="admin-sidebar-backdrop" aria-label="Dismiss navigation" onClick={() => setMobileOpen(false)} />}
    <aside id="admin-sidebar" className={`admin-sidebar ${mobileOpen ? "open" : ""} ${sidebarCollapsed ? "collapsed" : ""}`} aria-label="Admin navigation">
      <div className="admin-sidebar-header"><Link href="/" className="admin-brand"><span>ATTEND</span><strong>Admin</strong></Link><button type="button" className="admin-sidebar-collapse" aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"} aria-pressed={sidebarCollapsed} onClick={toggleSidebar}>{sidebarCollapsed ? "›" : "‹"}</button><button type="button" className="admin-sidebar-close" aria-label="Close navigation" onClick={() => setMobileOpen(false)}>×</button></div>
      {sidebarCollapsed && <button type="button" className="admin-sidebar-rail-button" onClick={toggleSidebar}><span aria-hidden="true">☰</span><span className="sr-only">Expand navigation</span></button>}
      <nav className="admin-nav" aria-label="Admin sections">
        {groups.map((group) => {
          const expanded = !collapsedGroups.includes(group.label);
          const groupId = `admin-group-${group.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
          return <section className="admin-nav-group" key={group.label}>
            <button type="button" className="admin-nav-disclosure" aria-expanded={expanded} aria-controls={groupId} onClick={() => toggleGroup(group.label)}>
              <span>{group.label}</span><span aria-hidden="true">{expanded ? "−" : "+"}</span>
            </button>
            {expanded && <div id={groupId} className="admin-nav-links">{group.items.map((item) => {
              if (item.external) return <a key={item.href} href={item.href} target="_blank" rel="noreferrer">{item.label} <span aria-hidden="true">↗</span></a>;
              const active = isAdminItemActive(pathname, item.href);
              return <Link key={item.href} href={item.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>{item.label}</Link>;
            })}</div>}
          </section>;
        })}
      </nav>
      <div className="admin-sidebar-account">
        <a className="admin-customer-site-link" href={CUSTOMER_WEB_URL} target="_blank" rel="noreferrer">View customer site <span aria-hidden="true">↗</span></a>
        {operationalSites.map((site) => <a key={site.label} className="admin-customer-site-link" href={site.href} target="_blank" rel="noreferrer">{site.label} <span aria-hidden="true">↗</span></a>)}
        <span>Signed in as</span><strong>{employee.name}</strong><button type="button" className="secondary" onClick={signOut}>Sign out</button>
      </div>
    </aside>
  </>;
}
