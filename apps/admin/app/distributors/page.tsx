"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAdminSession } from "../admin-session";
import { apiFetch, ApiRequestError } from "../lib/api-client";

type Distributor = { name: string; films: unknown[]; showtimes: number; ticketsSold: number; ticketRevenueCents: number; fnbRevenueCents: number; distributorRevenueCents: number; cinemaRevenueCents: number; unallocatedRevenueCents: number };
type Report = { location: { name: string; currency: string }; distributors: Distributor[] };
const money = (cents: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);

export default function DistributorsPage() {
  const { accessToken, employee } = useAdminSession();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let cancelled = false; apiFetch<Report>("/reports/distributors", { accessToken }).then((result) => { if (!cancelled) setReport(result); }).catch((reason) => { if (!cancelled) setError(reason instanceof ApiRequestError ? reason.body.message : "Distributors could not be loaded."); }); return () => { cancelled = true; }; }, [accessToken]);
  if (!employee.permissions.includes("reports.view.financial")) return <main className="admin-route-page"><div className="error-banner">You do not have permission to view distributor performance.</div></main>;
  const currency = report?.location.currency ?? "USD";
  return <main className="admin-route-page distributor-page"><section className="admin-heading"><div><p className="kicker">FILM RENTAL</p><h1>Distributors</h1><p>Review each distributor’s films, ticket sales, cinema and distributor shares, F&amp;B performance, and deal history.</p></div></section>{error && <div className="error-banner">{error}</div>}{!report && !error && <p className="dashboard-empty">Loading distributors…</p>}{report && <section className="panel distributor-directory"><div className="dashboard-section-heading"><div><p className="kicker">{report.location.name}</p><h2>Distributor directory</h2></div><span>{report.distributors.length} distributors</span></div><div className="distributor-table"><header><span>Distributor</span><span>Films</span><span>Shows</span><span>Tickets</span><span>Ticket value</span><span>Distributor / cinema</span></header>{report.distributors.map((distributor) => <Link href={`/distributors/${encodeURIComponent(distributor.name)}`} key={distributor.name}><strong>{distributor.name}</strong><span>{distributor.films.length}</span><span>{distributor.showtimes}</span><span>{distributor.ticketsSold}</span><span>{money(distributor.ticketRevenueCents, currency)}</span><span>{money(distributor.distributorRevenueCents, currency)} / {money(distributor.cinemaRevenueCents, currency)}</span></Link>)}</div>{report.distributors.length === 0 && <p className="dashboard-empty">No films have a distributor assigned yet. Add distributor details in the film library.</p>}</section>}</main>;
}
