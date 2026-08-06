"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAdminSession } from "./admin-session";

const links = [["/scheduling", "Scheduling"], ["/film-series", "Film Series"], ["/cinema-setup", "Cinema Setup"], ["/menu", "Menu"], ["/reports", "Reports & Finance"], ["/labor", "Labor"], ["/location", "Location"], ["/promotions", "Promotions"], ["/taxes", "Tax & Service Charges"], ["/users", "Users & Permissions"], ["/refunds", "Refunds"], ["/audit-log", "Audit Log"]] as const;

export function AdminNav() {
  const pathname = usePathname();
  const { employee, signOut } = useAdminSession();
  return <><header className="admin-topbar"><Link href="/scheduling" className="admin-brand"><span>ATTEND</span><strong>Admin</strong></Link><div><span>{employee.name}</span><button type="button" className="secondary" onClick={signOut}>Sign out</button></div></header><nav className="admin-nav" aria-label="Admin sections">{links.map(([href, label]) => <Link key={href} href={href} className={pathname === href ? "active" : ""}>{label}</Link>)}</nav></>;
}
