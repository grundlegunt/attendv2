"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAdminSession } from "../admin-session";
import { apiFetch, ApiRequestError } from "../lib/api-client";

type Distributor = { name: string; films: unknown[]; showtimes: number; ticketsSold: number; totalCapacity: number; attendancePercent: number; ticketRevenueCents: number; fnbRevenueCents: number; distributorRevenueCents: number; cinemaRevenueCents: number; unallocatedRevenueCents: number };
type Report = { location: { name: string; currency: string }; distributors: Distributor[] };
type Period = "all" | "30" | "90" | "365";
const money = (cents: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);

export default function DistributorsPage() {
  const { accessToken, employee } = useAdminSession();
  const [period, setPeriod] = useState<Period>("all");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = useMemo(() => {
    if (period === "all") return "/reports/distributors";
    const to = new Date();
    const from = new Date(to.getTime() - Number(period) * 86_400_000);
    return `/reports/distributors?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
  }, [period]);
  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    apiFetch<Report>(path, { accessToken })
      .then((result) => { if (!cancelled) setReport(result); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof ApiRequestError ? reason.body.message : "Distributors could not be loaded."); });
    return () => { cancelled = true; };
  }, [accessToken, path]);
  if (!employee.permissions.includes("reports.view.financial")) return <main className="admin-route-page"><div className="error-banner">You do not have permission to view distributor performance.</div></main>;
  const currency = report?.location.currency ?? "USD";
  return <main className="admin-route-page distributor-page">
    <section className="admin-heading"><div><p className="kicker">FILM RENTAL</p><h1>Distributors</h1><p>Review each distributor’s films, ticket sales, cinema and distributor shares, F&amp;B performance, and deal history.</p></div></section>
    <div className="series-period-switch">
      {(["all", "30", "90", "365"] as Period[]).map((value) => <button type="button" className={period === value ? "active" : ""} onClick={() => setPeriod(value)} key={value}>{value === "all" ? "All time" : `${value} days`}</button>)}
    </div>
    {error && <div className="error-banner">{error}</div>}
    {!report && !error && <p className="dashboard-empty">Loading distributors…</p>}
    {report && <section className="panel distributor-directory"><div className="dashboard-section-heading"><div><p className="kicker">{report.location.name}</p><h2>Distributor directory</h2></div><span>{report.distributors.length} distributors</span></div><div className="distributor-table"><header><span>Distributor</span><span>Films</span><span>Shows</span><span>Tickets / attendance</span><span>Ticket / F&amp;B</span><span>Distributor / cinema</span></header>{report.distributors.map((distributor) => <Link href={`/distributors/${encodeURIComponent(distributor.name)}`} key={distributor.name}><strong>{distributor.name}</strong><span>{distributor.films.length}</span><span>{distributor.showtimes}</span><span>{distributor.ticketsSold}<small>{distributor.attendancePercent}% of {distributor.totalCapacity}</small></span><span>{money(distributor.ticketRevenueCents, currency)}<small>{money(distributor.fnbRevenueCents, currency)} F&amp;B</small></span><span>{money(distributor.distributorRevenueCents, currency)} / {money(distributor.cinemaRevenueCents, currency)}</span></Link>)}</div>{report.distributors.length === 0 && <p className="dashboard-empty">No distributor performance was recorded in this period.</p>}</section>}
  </main>;
}
