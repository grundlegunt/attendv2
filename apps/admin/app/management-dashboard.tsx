"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch, ApiRequestError } from "./lib/api-client";
import { BrandingSummary, type BrandingSettings } from "./branding-editor";

type RevenueReport = {
  totals: { grossRevenueCents: number; refundedCents: number; ticketRefundedCents: number; fnbRefundedCents: number; ticketRevenueCents: number; fnbRevenueCents: number; combinedRevenueCents: number; ticketsSold: number; fnbOrders: number; averageFnbSpendPerOrderCents: number; averageFnbSpendPerSeatCents: number };
  movies: Array<{ movieId: string; title: string; ticketRevenueCents: number; ticketsSold: number; fnbRevenueCents: number }>;
  showtimes: Array<{ showtimeId: string; title: string; startsAt: string; ticketRevenueCents: number; ticketsSold: number; fnbRevenueCents: number }>;
};
type LaborReport = { totalMinutes: number; rows: Array<{ shiftId: string; employeeName: string; roles: string[]; clockInAt: string; clockOutAt: string | null; breakMinutes: number; workedMinutes: number }> };
type AuditEvent = { id: string; occurredAt: string; action: string; entityType: string; entityId: string; actorId: string | null };
type Settings = BrandingSettings & { id: string; timeClockEnabled: boolean; ticketTaxRateBasisPoints: number; taxRules: Array<{ id: string; name: string; ratePermille: number; active: boolean }>; serviceChargeRules: Array<{ id: string; name: string; ratePermille: number | null; flatCents: number | null; active: boolean }>; promotions: Array<{ id: string; code: string; name: string; type: string; active: boolean }> };

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const dateInput = (date: Date) => date.toISOString().slice(0, 10);

type ManagementSection = "reports" | "labor" | "branding" | "location" | "promotions" | "audit";

export function ManagementDashboard({ accessToken, permissions, section }: { accessToken: string; permissions: string[]; section: ManagementSection }) {
  const [from, setFrom] = useState(dateInput(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(dateInput(new Date(Date.now() + 86_400_000)));
  const [revenue, setRevenue] = useState<RevenueReport | null>(null);
  const [labor, setLabor] = useState<LaborReport | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [auditAction, setAuditAction] = useState("");
  const [promotion, setPromotion] = useState({ code: "", name: "", amountCents: 0 });
  const [error, setError] = useState<string | null>(null);
  const canFinancial = permissions.includes("reports.view.financial");
  const canReports = permissions.includes("reports.view");
  const canAudit = permissions.includes("audit.log.view");
  const canSettings = permissions.includes("ticket.price.edit");

  async function refresh() {
    setError(null);
    const range = `from=${encodeURIComponent(new Date(`${from}T00:00:00`).toISOString())}&to=${encodeURIComponent(new Date(`${to}T00:00:00`).toISOString())}`;
    try {
      const [nextRevenue, nextLabor, nextAudit, nextSettings] = await Promise.all([
        section === "reports" && canFinancial ? apiFetch<RevenueReport>(`/reports/revenue?${range}`, { accessToken }) : null,
        section === "labor" && canReports ? apiFetch<LaborReport>(`/reports/labor?${range}`, { accessToken }) : null,
        section === "audit" && canAudit ? apiFetch<AuditEvent[]>(`/audit-events?limit=100${auditAction ? `&action=${encodeURIComponent(auditAction)}` : ""}`, { accessToken }) : [],
        (section === "branding" || section === "location" || section === "promotions") && canSettings ? apiFetch<Settings>("/management/settings", { accessToken }) : null,
      ]);
      setRevenue(nextRevenue); setLabor(nextLabor); setAudit(nextAudit); setSettings(nextSettings);
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "Management data could not be loaded."); }
  }

  useEffect(() => { void refresh(); }, [accessToken, section]);

  async function toggleClock() {
    if (!settings) return;
    await apiFetch("/management/settings/location", { accessToken, method: "PATCH", body: JSON.stringify({ timeClockEnabled: !settings.timeClockEnabled }) });
    await refresh();
  }

  async function createPromotion(event: FormEvent) {
    event.preventDefault();
    await apiFetch("/management/settings/promotions", { accessToken, method: "POST", body: JSON.stringify({ code: promotion.code, name: promotion.name, type: "FIXED_AMOUNT", amountCents: promotion.amountCents, active: true }) });
    setPromotion({ code: "", name: "", amountCents: 0 }); await refresh();
  }

  async function exportHours() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ??
      (process.env.NODE_ENV === "production"
        ? "https://zealous-connection-production-0896.up.railway.app/api/v1"
        : "http://localhost:4000/api/v1");
    const response = await fetch(`${apiUrl}/reports/labor.csv?from=${encodeURIComponent(new Date(`${from}T00:00:00`).toISOString())}&to=${encodeURIComponent(new Date(`${to}T00:00:00`).toISOString())}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) { setError("The hours export could not be created."); return; }
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "attend-hours.csv"; anchor.click(); URL.revokeObjectURL(url);
  }

  return <section className="management-stack">
    <div className="panel management-heading">
      <div><p className="kicker">MANAGEMENT</p><h2>{section === "reports" ? "Reports & finance" : section === "labor" ? "Labor" : section === "branding" ? "Branding" : section === "location" ? "Location" : section === "promotions" ? "Promotions" : "Audit log"}</h2></div>
      {(section === "reports" || section === "labor") && <div className="report-range"><label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><button className="primary" onClick={() => void refresh()}>Refresh</button></div>}
      {error && <div className="error-banner">{error}</div>}
    </div>

    {revenue && <section className="panel"><p className="kicker">FINANCE</p><h2>Revenue overview</h2>
      <div className="stats"><div><strong>{money(revenue.totals.grossRevenueCents)}</strong><span>Gross revenue</span></div><div><strong>{money(revenue.totals.refundedCents)}</strong><span>Refunds</span></div><div><strong>{money(revenue.totals.combinedRevenueCents)}</strong><span>Net revenue</span></div><div><strong>{revenue.totals.ticketsSold}</strong><span>Tickets sold</span></div><div><strong>{money(revenue.totals.averageFnbSpendPerOrderCents)}</strong><span>Average F&amp;B per order</span></div><div><strong>{money(revenue.totals.averageFnbSpendPerSeatCents)}</strong><span>Average F&amp;B per occupied seat</span></div></div>
      <h3>By movie</h3><div className="management-table"><div className="table-row table-head"><span>Movie</span><span>Tickets</span><span>Ticket revenue</span><span>F&B revenue</span></div>{revenue.movies.map((row) => <div className="table-row" key={row.movieId}><strong>{row.title}</strong><span>{row.ticketsSold}</span><span>{money(row.ticketRevenueCents)}</span><span>{money(row.fnbRevenueCents)}</span></div>)}</div>
      <h3>By showtime</h3><div className="management-table"><div className="table-row table-head"><span>Showing</span><span>Tickets</span><span>Ticket revenue</span><span>F&B revenue</span></div>{revenue.showtimes.map((row) => <div className="table-row" key={row.showtimeId}><strong>{row.title}<small>{new Date(row.startsAt).toLocaleString()}</small></strong><span>{row.ticketsSold}</span><span>{money(row.ticketRevenueCents)}</span><span>{money(row.fnbRevenueCents)}</span></div>)}</div>
    </section>}

    {labor && <section className="panel"><p className="kicker">LABOR</p><h2>Hours</h2><p><strong>{(labor.totalMinutes / 60).toFixed(2)}</strong> total hours</p><button className="primary" onClick={() => void exportHours()}>Export CSV</button><div className="management-table"><div className="table-row table-head"><span>Employee</span><span>Roles</span><span>Clock in</span><span>Hours</span></div>{labor.rows.map((row) => <div className="table-row" key={row.shiftId}><strong>{row.employeeName}</strong><span>{row.roles.join(", ")}</span><span>{new Date(row.clockInAt).toLocaleString()}</span><span>{(row.workedMinutes / 60).toFixed(2)}</span></div>)}</div></section>}

    {settings && section === "branding" && <BrandingSummary settings={settings} />}
    {settings && section === "location" && <section className="panel"><p className="kicker">LOCATION</p><h2>Operating settings</h2><label className="checkbox"><input type="checkbox" checked={settings.timeClockEnabled} onChange={() => void toggleClock()} /> Require staff clock-in at this location</label><p>Ticket tax: {(settings.ticketTaxRateBasisPoints / 100).toFixed(2)}%</p></section>}
    {settings && section === "promotions" && <form className="panel" onSubmit={(event) => void createPromotion(event)}><p className="kicker">PROMOTIONS</p><h2>Create fixed discount</h2><label>Code<input required value={promotion.code} onChange={(event) => setPromotion({ ...promotion, code: event.target.value })} /></label><label>Name<input required value={promotion.name} onChange={(event) => setPromotion({ ...promotion, name: event.target.value })} /></label><label>Amount in cents<input type="number" min="1" required value={promotion.amountCents} onChange={(event) => setPromotion({ ...promotion, amountCents: Number(event.target.value) })} /></label><button className="primary">Create promotion</button><ul>{settings.promotions.map((item) => <li key={item.id}><strong>{item.code}</strong> · {item.name} · {item.active ? "Active" : "Inactive"}</li>)}</ul></form>}

    {section === "audit" && canAudit && <section className="panel"><p className="kicker">AUDIT</p><h2>Activity log</h2><div className="report-range"><label>Action filter<input value={auditAction} onChange={(event) => setAuditAction(event.target.value)} placeholder="refund, settings, employee…" /></label><button className="secondary" onClick={() => void refresh()}>Apply</button></div><div className="audit-list">{audit.map((event) => <article key={event.id}><div><strong>{event.action}</strong><span>{event.entityType} · {event.entityId}</span></div><time>{new Date(event.occurredAt).toLocaleString()}</time></article>)}</div></section>}
  </section>;
}
