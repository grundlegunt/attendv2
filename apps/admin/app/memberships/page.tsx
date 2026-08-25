"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAdminSession } from "../admin-session";
import { apiFetch, ApiRequestError } from "../lib/api-client";

type Status = "" | "ACTIVE" | "EXPIRED" | "SUSPENDED" | "CANCELED";
type Membership = { id: string; membershipNumber: string; tier: string; status: Exclude<Status, "">; expiresAt: string | null; updatedAt: string; customer: { id: string; name: string | null; email: string | null; phone: string | null } };

export default function MembershipsPage() {
  const { accessToken, employee } = useAdminSession();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("");
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (query.trim()) params.set("query", query.trim());
      if (status) params.set("status", status);
      setLoading(true); setError(null);
      apiFetch<Membership[]>(`/management/memberships${params.size ? `?${params}` : ""}`, { accessToken, signal: controller.signal })
        .then(setMemberships)
        .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof ApiRequestError ? reason.body.message : "Memberships could not be loaded."); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [accessToken, query, status]);

  const date = (value: string) => new Date(value).toLocaleDateString([], { timeZone: employee.timezone, month: "short", day: "numeric", year: "numeric" });
  return <main className="admin-route-page membership-directory-page">
    <header className="admin-page-heading"><div><p className="kicker">CUSTOMER PROGRAMS</p><h1>Memberships</h1><p>Find and maintain memberships issued by the cinema or an external membership system.</p></div><Link href="/search" className="primary">Find a customer</Link></header>
    <section className="panel membership-directory-filters"><label>Search<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Member number, tier, name, email, or phone" /></label><label>Status<select value={status} onChange={(event) => setStatus(event.target.value as Status)}><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="EXPIRED">Expired</option><option value="SUSPENDED">Suspended</option><option value="CANCELED">Canceled</option></select></label></section>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <section className="panel membership-directory"><div className="dashboard-section-heading"><div><p className="kicker">DIRECTORY</p><h2>Member records</h2></div><span>{memberships.length} shown</span></div>
      {loading ? <p className="dashboard-empty">Loading memberships…</p> : <div className="membership-directory-table"><header><span>Member</span><span>Customer</span><span>Tier</span><span>Status</span><span>Expiration</span><span>Updated</span></header>{memberships.map((membership) => <Link href={`/customers/${membership.customer.id}`} key={membership.id}><span><strong>#{membership.membershipNumber}</strong></span><span><strong>{membership.customer.name || "Unnamed customer"}</strong><small>{membership.customer.email || membership.customer.phone || "No contact details"}</small></span><span>{membership.tier}</span><span className="status-chip">{membership.status.toLowerCase()}</span><span>{membership.expiresAt ? date(membership.expiresAt) : "No expiration"}</span><span>{date(membership.updatedAt)}</span></Link>)}</div>}
      {!loading && !memberships.length && <p className="dashboard-empty">No memberships match these filters.</p>}
    </section>
  </main>;
}
