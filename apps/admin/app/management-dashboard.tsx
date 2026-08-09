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
type AuditEvent = {
  id: string; occurredAt: string; action: string; entityType: string; entityId: string;
  actorType: string; actorId: string | null; beforeState: unknown; afterState: unknown;
};
type PromotionType = "FIXED_AMOUNT" | "PERCENTAGE" | "COMP";
type Settings = BrandingSettings & { id: string; timeClockEnabled: boolean; ticketTaxRateBasisPoints: number; taxRules: Array<{ id: string; name: string; ratePermille: number; active: boolean }>; serviceChargeRules: Array<{ id: string; name: string; ratePermille: number | null; flatCents: number | null; active: boolean }>; promotions: Array<{ id: string; code: string; name: string; type: PromotionType; amountCents: number | null; percentageBasisPoints: number | null; active: boolean; startsAt: string | null; endsAt: string | null }> };

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
  const [auditEntityType, setAuditEntityType] = useState("");
  const [auditActorId, setAuditActorId] = useState("");
  const [promotion, setPromotion] = useState({ code: "", name: "", type: "FIXED_AMOUNT" as PromotionType, value: 0, startsAt: "", endsAt: "" });
  const [error, setError] = useState<string | null>(null);
  const canFinancial = permissions.includes("reports.view.financial");
  const canReports = permissions.includes("reports.view");
  const canAudit = permissions.includes("audit.log.view");
  const canSettings = permissions.includes("ticket.price.edit");

  async function refresh() {
    setError(null);
    const range = `from=${encodeURIComponent(new Date(`${from}T00:00:00`).toISOString())}&to=${encodeURIComponent(new Date(`${to}T00:00:00`).toISOString())}`;
    const auditQuery = new URLSearchParams({ limit: "200", from: new Date(`${from}T00:00:00`).toISOString(), to: new Date(`${to}T00:00:00`).toISOString() });
    if (auditAction.trim()) auditQuery.set("action", auditAction.trim());
    if (auditEntityType.trim()) auditQuery.set("entityType", auditEntityType.trim());
    if (auditActorId.trim()) auditQuery.set("actorId", auditActorId.trim());
    try {
      const [nextRevenue, nextLabor, nextAudit, nextSettings] = await Promise.all([
        section === "reports" && canFinancial ? apiFetch<RevenueReport>(`/reports/revenue?${range}`, { accessToken }) : null,
        section === "labor" && canReports ? apiFetch<LaborReport>(`/reports/labor?${range}`, { accessToken }) : null,
        section === "audit" && canAudit ? apiFetch<AuditEvent[]>(`/audit-events?${auditQuery.toString()}`, { accessToken }) : [],
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
    setError(null);
    if (promotion.startsAt && promotion.endsAt && new Date(promotion.startsAt) >= new Date(promotion.endsAt)) { setError("Promotion end time must be after its start time."); return; }
    const body = {
      code: promotion.code, name: promotion.name, type: promotion.type, active: true,
      ...(promotion.type === "FIXED_AMOUNT" ? { amountCents: Math.round(promotion.value * 100) } : {}),
      ...(promotion.type === "PERCENTAGE" ? { percentageBasisPoints: Math.round(promotion.value * 100) } : {}),
      ...(promotion.startsAt ? { startsAt: new Date(promotion.startsAt).toISOString() } : {}),
      ...(promotion.endsAt ? { endsAt: new Date(promotion.endsAt).toISOString() } : {}),
    };
    try {
      await apiFetch("/management/settings/promotions", { accessToken, method: "POST", body: JSON.stringify(body) });
      setPromotion({ code: "", name: "", type: "FIXED_AMOUNT", value: 0, startsAt: "", endsAt: "" });
      await refresh();
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "The promotion could not be created."); }
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
    {settings && section === "promotions" && <section className="panel promotions-manager"><p className="kicker">PROMOTIONS</p><h2>Discount codes</h2><p>Create a fixed discount, percentage discount, or complimentary-ticket code. Date windows are optional.</p>
      <form className="promotion-form" onSubmit={(event) => void createPromotion(event)}>
        <label>Code<input required maxLength={50} value={promotion.code} onChange={(event) => setPromotion({ ...promotion, code: event.target.value.toUpperCase() })} placeholder="SUMMER20" /></label>
        <label>Name<input required maxLength={100} value={promotion.name} onChange={(event) => setPromotion({ ...promotion, name: event.target.value })} placeholder="Summer member offer" /></label>
        <label>Discount type<select value={promotion.type} onChange={(event) => setPromotion({ ...promotion, type: event.target.value as PromotionType, value: 0 })}><option value="FIXED_AMOUNT">Fixed amount</option><option value="PERCENTAGE">Percentage</option><option value="COMP">Complimentary</option></select></label>
        {promotion.type !== "COMP" && <label>{promotion.type === "FIXED_AMOUNT" ? "Amount ($)" : "Percentage (%)"}<input type="number" min="0.01" max={promotion.type === "PERCENTAGE" ? 100 : undefined} step="0.01" required value={promotion.value || ""} onChange={(event) => setPromotion({ ...promotion, value: Number(event.target.value) })} /></label>}
        <label>Starts (optional)<input type="datetime-local" value={promotion.startsAt} onChange={(event) => setPromotion({ ...promotion, startsAt: event.target.value })} /></label>
        <label>Ends (optional)<input type="datetime-local" value={promotion.endsAt} onChange={(event) => setPromotion({ ...promotion, endsAt: event.target.value })} /></label>
        <button className="primary">Create promotion</button>
      </form>
      <div className="promotion-list">{settings.promotions.map((item) => <article key={item.id}><div><strong>{item.code}</strong><span>{item.name}</span></div><b>{item.type === "FIXED_AMOUNT" ? money(item.amountCents ?? 0) : item.type === "PERCENTAGE" ? `${((item.percentageBasisPoints ?? 0) / 100).toFixed(2).replace(/\.00$/, "")}%` : "Comp"}</b><span>{item.startsAt ? new Date(item.startsAt).toLocaleString() : "Immediately"} → {item.endsAt ? new Date(item.endsAt).toLocaleString() : "No end date"}</span><em>{item.active ? "Active" : "Inactive"}</em></article>)}</div>
    </section>}

    {section === "audit" && canAudit && <section className="panel"><p className="kicker">AUDIT</p><h2>Activity log</h2>
      <form className="audit-filters" onSubmit={(event) => { event.preventDefault(); void refresh(); }}>
        <label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <label>Action<input value={auditAction} onChange={(event) => setAuditAction(event.target.value)} placeholder="refund, settings, employee…" /></label>
        <label>Entity type<input value={auditEntityType} onChange={(event) => setAuditEntityType(event.target.value)} placeholder="Employee, Promotion…" /></label>
        <label>Actor ID<input value={auditActorId} onChange={(event) => setAuditActorId(event.target.value)} placeholder="Employee ID" /></label>
        <button className="primary">Apply filters</button>
      </form>
      <div className="audit-list">{audit.map((event) => <details key={event.id} className="audit-event">
        <summary><span><strong>{event.action}</strong><small>{event.entityType} · {event.entityId}</small></span><span><time>{new Date(event.occurredAt).toLocaleString()}</time><small>{event.actorType}{event.actorId ? ` · ${event.actorId}` : ""}</small></span></summary>
        <div className="audit-change-grid"><section><h3>Before</h3><pre>{event.beforeState == null ? "No prior state recorded" : JSON.stringify(event.beforeState, null, 2)}</pre></section><section><h3>After</h3><pre>{event.afterState == null ? "No resulting state recorded" : JSON.stringify(event.afterState, null, 2)}</pre></section></div>
      </details>)}{audit.length === 0 && <p className="dashboard-empty">No activity matches these filters.</p>}</div>
    </section>}
  </section>;
}
