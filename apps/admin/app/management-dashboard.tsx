"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiDownload, apiFetch, ApiRequestError } from "./lib/api-client";
import { BrandingSummary, CustomerSiteCopyEditor, type BrandingDraft, type BrandingSettings, type CustomerSiteCopy } from "./branding-editor";
import { CUSTOMER_WEB_URL } from "./lib/customer-site";
import { inclusiveDateCutoff, inclusiveReportRange, localDateInputValue } from "./report-range";

type RevenueReport = {
  totals: { grossRevenueCents: number; refundedCents: number; ticketRefundedCents: number; fnbRefundedCents: number; ticketRevenueCents: number; ticketFeesCents: number; ticketTaxCents: number; ticketCollectedCents: number; fnbRevenueCents: number; combinedRevenueCents: number; ticketsSold: number; fnbOrders: number; averageFnbSpendPerOrderCents: number; averageFnbSpendPerSeatCents: number; averageTotalSpendPerPatronCents: number; concessionAttachRatePercent: number };
  movies: Array<{ movieId: string; title: string; ticketRevenueCents: number; ticketsSold: number; fnbRevenueCents: number }>;
  showtimes: Array<{ showtimeId: string; title: string; startsAt: string; ticketRevenueCents: number; ticketsSold: number; fnbRevenueCents: number }>;
  admissionTypes: Array<{ ticketTypeId: string; name: string; ticketsSold: number; ticketRevenueCents: number }>;
  salesChannels: Array<{ channel: "ONLINE" | "BOX_OFFICE"; ticketsSold: number; ticketRevenueCents: number; grossCollectedCents: number; refundedCents: number; netCollectedCents: number }>;
  salesOperators: Array<{ employeeId: string; employeeName: string; ticketsSold: number; grossCollectedCents: number; refundedCents: number; netCollectedCents: number }>;
  concessionTopSellers: Array<{ menuItemId: string; name: string; unitsSold: number; salesCents: number }>;
  dailyPerformance: Array<{ date: string; ticketsSold: number; ticketCollectedCents: number; fnbRevenueCents: number; combinedRevenueCents: number; averageTotalSpendPerPatronCents: number }>;
};
type AudienceOriginsReport = {
  totals: { completedOrders: number; ordersWithZip: number; ticketsWithZip: number; coveragePercent: number };
  origins: Array<{ zipCode: string; orders: number; tickets: number; sharePercent: number }>;
};
type LaborRow = { shiftId: string; employeeName: string; roles: string[]; clockInAt: string; clockOutAt: string | null; breakStartAt: string | null; breakEndAt: string | null; breakMinutes: number; workedMinutes: number };
type LaborReport = { totalMinutes: number; rows: LaborRow[] };
type AuditEvent = {
  id: string; occurredAt: string; action: string; entityType: string; entityId: string;
  actorType: string; actorId: string | null; beforeState: unknown; afterState: unknown;
};
type PromotionType = "FIXED_AMOUNT" | "PERCENTAGE" | "COMP";
type PromotionDraft = { code: string; name: string; type: PromotionType; value: number; minimumSubtotal: number; maximumRedemptions: number; startsAt: string; endsAt: string };
type Promotion = { id: string; code: string; name: string; type: PromotionType; amountCents: number | null; percentageBasisPoints: number | null; minimumSubtotalCents: number | null; maximumRedemptions: number | null; active: boolean; startsAt: string | null; endsAt: string | null; redemptionCount: number; discountedTicketCount: number; totalTicketFaceValueCents: number; totalCollectedCents: number; totalDiscountCents: number };
type CustomerRecencySegment = { inactiveSince: string; total: number; preview: Array<{ id: string; name: string; email: string; lastPurchaseAt: string; lastOrderNumber: string; lastOrderTotalCents: number }> };
type OperatingSettings = { name: string; address: string | null; timezone: string; currency: string; timeClockEnabled: boolean; ticketTaxRateBasisPoints: number; preShowBufferMinutes: number; cleaningBufferMinutes: number; checkDropMinutesBeforeEnd: number; autoSettleGraceMinutes: number; autoSettleTipBasisPoints: number };
type Settings = BrandingSettings & OperatingSettings & { id: string; merchUrl: string | null; siteCopy: CustomerSiteCopy; taxRules: Array<{ id: string; name: string; ratePermille: number; active: boolean }>; serviceChargeRules: Array<{ id: string; name: string; ratePermille: number | null; flatCents: number | null; active: boolean }>; promotions: Promotion[] };

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const dateTimeInput = (value: string | null) => { if (!value) return ""; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
const emptyPromotion = (): PromotionDraft => ({ code: "", name: "", type: "FIXED_AMOUNT", value: 0, minimumSubtotal: 0, maximumRedemptions: 0, startsAt: "", endsAt: "" });
const promotionDraft = (item: Promotion): PromotionDraft => ({ code: item.code, name: item.name, type: item.type, value: item.type === "FIXED_AMOUNT" ? (item.amountCents ?? 0) / 100 : item.type === "PERCENTAGE" ? (item.percentageBasisPoints ?? 0) / 100 : 0, minimumSubtotal: (item.minimumSubtotalCents ?? 0) / 100, maximumRedemptions: item.maximumRedemptions ?? 0, startsAt: dateTimeInput(item.startsAt), endsAt: dateTimeInput(item.endsAt) });
const promotionBody = (draft: PromotionDraft, clearEmpty = false) => ({ code: draft.code, name: draft.name, type: draft.type, ...(draft.type === "FIXED_AMOUNT" ? { amountCents: Math.round(draft.value * 100), ...(clearEmpty ? { percentageBasisPoints: null } : {}) } : {}), ...(draft.type === "PERCENTAGE" ? { percentageBasisPoints: Math.round(draft.value * 100), ...(clearEmpty ? { amountCents: null } : {}) } : {}), ...(draft.type === "COMP" && clearEmpty ? { amountCents: null, percentageBasisPoints: null } : {}), ...(draft.minimumSubtotal > 0 ? { minimumSubtotalCents: Math.round(draft.minimumSubtotal * 100) } : clearEmpty ? { minimumSubtotalCents: null } : {}), ...(draft.maximumRedemptions > 0 ? { maximumRedemptions: draft.maximumRedemptions } : clearEmpty ? { maximumRedemptions: null } : {}), ...(draft.startsAt ? { startsAt: new Date(draft.startsAt).toISOString() } : clearEmpty ? { startsAt: null } : {}), ...(draft.endsAt ? { endsAt: new Date(draft.endsAt).toISOString() } : clearEmpty ? { endsAt: null } : {}) });

type ManagementSection = "reports" | "labor" | "branding" | "location" | "promotions" | "audit";

export function ManagementDashboard({ accessToken, permissions, section }: { accessToken: string; permissions: string[]; section: ManagementSection }) {
  const [from, setFrom] = useState(localDateInputValue(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(localDateInputValue(new Date()));
  const [revenue, setRevenue] = useState<RevenueReport | null>(null);
  const [audienceOrigins, setAudienceOrigins] = useState<AudienceOriginsReport | null>(null);
  const [labor, setLabor] = useState<LaborReport | null>(null);
  const [shiftDraft, setShiftDraft] = useState<{ shiftId: string; employeeName: string; clockInAt: string; clockOutAt: string; breakStartAt: string; breakEndAt: string; notes: string } | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [auditHasMore, setAuditHasMore] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [merchUrl, setMerchUrl] = useState("");
  const [locationDraft, setLocationDraft] = useState<OperatingSettings | null>(null);
  const [auditAction, setAuditAction] = useState("");
  const [auditEntityType, setAuditEntityType] = useState("");
  const [auditActorId, setAuditActorId] = useState("");
  const [promotion, setPromotion] = useState<PromotionDraft>(emptyPromotion);
  const [promotionEdit, setPromotionEdit] = useState<{ id: string; draft: PromotionDraft } | null>(null);
  const [inactiveSince, setInactiveSince] = useState(localDateInputValue(new Date(Date.now() - 365 * 86_400_000)));
  const [customerSegment, setCustomerSegment] = useState<CustomerRecencySegment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canFinancial = permissions.includes("reports.view.financial");
  const canReports = permissions.includes("reports.view");
  const canEditEmployees = permissions.includes("employee.edit");
  const canAudit = permissions.includes("audit.log.view");
  const canSettings = permissions.includes("ticket.price.edit");

  async function refresh(appendAudit = false) {
    setError(null);
    try {
      const reportRange = inclusiveReportRange(from, to);
      const range = new URLSearchParams(reportRange).toString();
      const auditQuery = new URLSearchParams({ limit: "50", offset: appendAudit ? String(audit.length) : "0", ...reportRange });
      if (auditAction.trim()) auditQuery.set("action", auditAction.trim());
      if (auditEntityType.trim()) auditQuery.set("entityType", auditEntityType.trim());
      if (auditActorId.trim()) auditQuery.set("actorId", auditActorId.trim());
      const [nextRevenue, nextAudienceOrigins, nextLabor, nextAudit, nextSettings] = await Promise.all([
        section === "reports" && canFinancial ? apiFetch<RevenueReport>(`/reports/revenue?${range}`, { accessToken }) : null,
        section === "reports" && canFinancial ? apiFetch<AudienceOriginsReport>(`/reports/audience-origins?${range}`, { accessToken }) : null,
        section === "labor" && canReports ? apiFetch<LaborReport>(`/reports/labor?${range}`, { accessToken }) : null,
        section === "audit" && canAudit ? apiFetch<AuditEvent[]>(`/audit-events?${auditQuery.toString()}`, { accessToken }) : [],
        (section === "branding" || section === "location" || section === "promotions") && canSettings ? apiFetch<Settings>("/management/settings", { accessToken }) : null,
      ]);
      setRevenue(nextRevenue); setAudienceOrigins(nextAudienceOrigins); setLabor(nextLabor); setAudit(appendAudit ? [...audit, ...nextAudit] : nextAudit); setAuditHasMore(section === "audit" && nextAudit.length === 50); setSettings(nextSettings);
      if (section === "branding" && nextSettings) setMerchUrl(nextSettings.merchUrl ?? "");
      if (section === "location" && nextSettings) setLocationDraft({ name: nextSettings.name, address: nextSettings.address, timezone: nextSettings.timezone, currency: nextSettings.currency, timeClockEnabled: nextSettings.timeClockEnabled, ticketTaxRateBasisPoints: nextSettings.ticketTaxRateBasisPoints, preShowBufferMinutes: nextSettings.preShowBufferMinutes, cleaningBufferMinutes: nextSettings.cleaningBufferMinutes, checkDropMinutesBeforeEnd: nextSettings.checkDropMinutesBeforeEnd, autoSettleGraceMinutes: nextSettings.autoSettleGraceMinutes, autoSettleTipBasisPoints: nextSettings.autoSettleTipBasisPoints });
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "Management data could not be loaded."); }
  }

  useEffect(() => { void refresh(); }, [accessToken, section]);

  async function saveLocation(event: FormEvent) {
    event.preventDefault();
    if (!locationDraft) return;
    setError(null);
    try {
      await apiFetch("/management/settings/location", { accessToken, method: "PATCH", body: JSON.stringify({ ...locationDraft, address: locationDraft.address?.trim() || null, currency: undefined }) });
      await refresh();
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "Location settings could not be saved."); }
  }

  async function saveBranding(draft: BrandingDraft) {
    setError(null);
    try {
      await apiFetch("/management/settings/branding", { accessToken, method: "PATCH", body: JSON.stringify({ ...draft, logoUrl: draft.logoUrl.trim() || null }) });
      await refresh();
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "Brand settings could not be saved."); throw reason; }
  }

  async function saveSiteCopy(copy: CustomerSiteCopy) {
    setError(null);
    try {
      await apiFetch("/management/settings/site-copy", { accessToken, method: "PATCH", body: JSON.stringify(copy) });
      await refresh();
    } catch (reason) {
      setError(reason instanceof ApiRequestError ? reason.body.message : "The customer website copy could not be published.");
      throw reason;
    }
  }

  async function saveMerch(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await apiFetch("/management/settings/merch", { accessToken, method: "PATCH", body: JSON.stringify({ merchUrl: merchUrl.trim() || null }) });
      await refresh();
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "The merchandise shop link could not be saved."); }
  }

  async function createPromotion(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (promotion.startsAt && promotion.endsAt && new Date(promotion.startsAt) >= new Date(promotion.endsAt)) { setError("Promotion end time must be after its start time."); return; }
    const body = { ...promotionBody(promotion), active: true };
    try {
      await apiFetch("/management/settings/promotions", { accessToken, method: "POST", body: JSON.stringify(body) });
      setPromotion(emptyPromotion());
      await refresh();
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "The promotion could not be created."); }
  }
  async function savePromotion(event: FormEvent) {
    event.preventDefault();
    if (!promotionEdit) return;
    setError(null);
    if (promotionEdit.draft.startsAt && promotionEdit.draft.endsAt && new Date(promotionEdit.draft.startsAt) >= new Date(promotionEdit.draft.endsAt)) { setError("Promotion end time must be after its start time."); return; }
    try {
      await apiFetch(`/management/settings/promotions/${promotionEdit.id}`, { accessToken, method: "PATCH", body: JSON.stringify(promotionBody(promotionEdit.draft, true)) });
      setPromotionEdit(null);
      await refresh();
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "The promotion could not be updated."); }
  }
  async function togglePromotion(item: Settings["promotions"][number]) {
    setError(null);
    try {
      await apiFetch(`/management/settings/promotions/${item.id}`, { accessToken, method: "PATCH", body: JSON.stringify({ active: !item.active }) });
      await refresh();
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "The promotion could not be updated."); }
  }
  async function previewCustomerSegment(event: FormEvent) {
    event.preventDefault(); setError(null);
    try { setCustomerSegment(await apiFetch<CustomerRecencySegment>(`/reports/customer-recency?inactiveSince=${encodeURIComponent(inclusiveDateCutoff(inactiveSince))}&limit=25`, { accessToken })); }
    catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "The customer segment could not be previewed."); }
  }

  async function downloadReport(path: string, filename: string, fallbackMessage: string) {
    setError(null);
    try {
      const blob = await apiDownload(path, { accessToken });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof ApiRequestError ? reason.body.message : fallbackMessage);
    }
  }

  function exportHours() {
    return downloadReport(`/reports/labor.csv?${new URLSearchParams(inclusiveReportRange(from, to)).toString()}`, "attend-hours.csv", "The hours export could not be downloaded.");
  }

  function editShift(row: LaborRow) {
    setShiftDraft({ shiftId: row.shiftId, employeeName: row.employeeName, clockInAt: dateTimeInput(row.clockInAt), clockOutAt: dateTimeInput(row.clockOutAt), breakStartAt: dateTimeInput(row.breakStartAt), breakEndAt: dateTimeInput(row.breakEndAt), notes: "" });
  }

  async function saveShift(event: FormEvent) {
    event.preventDefault();
    if (!shiftDraft) return;
    setError(null);
    if (shiftDraft.clockOutAt && new Date(shiftDraft.clockOutAt) <= new Date(shiftDraft.clockInAt)) { setError("Clock-out must be after clock-in."); return; }
    if (shiftDraft.breakStartAt && new Date(shiftDraft.breakStartAt) < new Date(shiftDraft.clockInAt)) { setError("Break start cannot be before clock-in."); return; }
    if (shiftDraft.breakEndAt && (!shiftDraft.breakStartAt || new Date(shiftDraft.breakEndAt) <= new Date(shiftDraft.breakStartAt))) { setError("Break end must be after break start."); return; }
    if (shiftDraft.clockOutAt && shiftDraft.breakStartAt && new Date(shiftDraft.breakStartAt) > new Date(shiftDraft.clockOutAt)) { setError("Break start cannot be after clock-out."); return; }
    if (shiftDraft.clockOutAt && shiftDraft.breakEndAt && new Date(shiftDraft.breakEndAt) > new Date(shiftDraft.clockOutAt)) { setError("Break end cannot be after clock-out."); return; }
    try {
      await apiFetch(`/shifts/${shiftDraft.shiftId}`, { accessToken, method: "PATCH", body: JSON.stringify({ clockInAt: new Date(shiftDraft.clockInAt).toISOString(), clockOutAt: shiftDraft.clockOutAt ? new Date(shiftDraft.clockOutAt).toISOString() : null, breakStartAt: shiftDraft.breakStartAt ? new Date(shiftDraft.breakStartAt).toISOString() : null, breakEndAt: shiftDraft.breakEndAt ? new Date(shiftDraft.breakEndAt).toISOString() : null, notes: shiftDraft.notes }) });
      setShiftDraft(null);
      await refresh();
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "The shift could not be adjusted."); }
  }

  function exportRevenue() {
    return downloadReport(`/reports/revenue.csv?${new URLSearchParams(inclusiveReportRange(from, to)).toString()}`, "attend-revenue.csv", "The revenue export could not be downloaded.");
  }

  function exportDistributorBoxOffice() {
    return downloadReport(`/reports/distributor-box-office.csv?${new URLSearchParams(inclusiveReportRange(from, to)).toString()}`, "attend-distributor-box-office.csv", "The distributor box-office report could not be downloaded.");
  }

  return <section className="management-stack">
    <div className="panel management-heading">
      <div><p className="kicker">MANAGEMENT</p><h2>{section === "reports" ? "Reports & finance" : section === "labor" ? "Labor" : section === "branding" ? "Branding" : section === "location" ? "Location" : section === "promotions" ? "Promotions" : "Audit log"}</h2></div>
      {(section === "reports" || section === "labor") && <div className="report-range"><label>From<input type="date" required value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Through<input type="date" required value={to} onChange={(event) => setTo(event.target.value)} /></label><button className="primary" onClick={() => void refresh()}>Refresh</button></div>}
      {error && <div className="error-banner">{error}</div>}
    </div>

    {revenue && <section className="panel"><p className="kicker">FINANCE</p><h2>Revenue overview</h2>
      <div className="stats"><div><strong>{money(revenue.totals.grossRevenueCents)}</strong><span>Gross revenue</span></div><div><strong>{money(revenue.totals.refundedCents)}</strong><span>Refunds</span></div><div><strong>{money(revenue.totals.combinedRevenueCents)}</strong><span>Net revenue</span></div><div><strong>{revenue.totals.ticketsSold}</strong><span>Tickets sold</span></div><div><strong>{money(revenue.totals.ticketRevenueCents)}</strong><span>Ticket face value</span></div><div><strong>{money(revenue.totals.ticketFeesCents)}</strong><span>Ticket fees</span></div><div><strong>{money(revenue.totals.ticketTaxCents)}</strong><span>Ticket tax</span></div><div><strong>{money(revenue.totals.ticketCollectedCents)}</strong><span>Ticket total collected</span></div><div><strong>{money(revenue.totals.averageFnbSpendPerOrderCents)}</strong><span>Average F&amp;B per order</span></div><div><strong>{money(revenue.totals.averageFnbSpendPerSeatCents)}</strong><span>Average F&amp;B per occupied seat</span></div><div><strong>{money(revenue.totals.averageTotalSpendPerPatronCents)}</strong><span>Average total spend per patron</span></div><div><strong>{revenue.totals.concessionAttachRatePercent}%</strong><span>Concession attach rate</span></div></div>
      <div className="report-export-actions"><button className="primary report-export" onClick={() => void exportRevenue()}>Export revenue CSV</button><button className="secondary report-export" onClick={() => void exportDistributorBoxOffice()}>Export distributor box office</button></div>
      <h3>By movie</h3><div className="management-table"><div className="table-row table-head"><span>Movie</span><span>Tickets</span><span>Ticket face value</span><span>F&B revenue</span></div>{revenue.movies.map((row) => <div className="table-row" key={row.movieId}><strong>{row.title}</strong><span>{row.ticketsSold}</span><span>{money(row.ticketRevenueCents)}</span><span>{money(row.fnbRevenueCents)}</span></div>)}</div>
      <h3>By showtime</h3><div className="management-table"><div className="table-row table-head"><span>Showing</span><span>Tickets</span><span>Ticket face value</span><span>F&B revenue</span></div>{revenue.showtimes.map((row) => <div className="table-row" key={row.showtimeId}><strong>{row.title}<small>{new Date(row.startsAt).toLocaleString()}</small></strong><span>{row.ticketsSold}</span><span>{money(row.ticketRevenueCents)}</span><span>{money(row.fnbRevenueCents)}</span></div>)}</div>
      <h3>By admission type</h3><div className="management-table"><div className="table-row table-head"><span>Admission type</span><span>Tickets</span><span>Ticket face value</span><span>Average ticket</span></div>{revenue.admissionTypes.map((row) => <div className="table-row" key={row.ticketTypeId}><strong>{row.name}</strong><span>{row.ticketsSold}</span><span>{money(row.ticketRevenueCents)}</span><span>{money(row.ticketsSold ? Math.round(row.ticketRevenueCents / row.ticketsSold) : 0)}</span></div>)}</div>
      <h3>By sales channel</h3><div className="management-table"><div className="table-row table-head"><span>Channel</span><span>Tickets</span><span>Refunds</span><span>Net collected</span></div>{revenue.salesChannels.map((row) => <div className="table-row" key={row.channel}><strong>{row.channel === "BOX_OFFICE" ? "Box office" : "Online"}</strong><span>{row.ticketsSold}</span><span>{money(row.refundedCents)}</span><span>{money(row.netCollectedCents)}</span></div>)}</div>
      <h3>By box-office operator</h3><div className="management-table"><div className="table-row table-head"><span>Operator</span><span>Tickets</span><span>Refunds</span><span>Net collected</span></div>{revenue.salesOperators.map((row) => <div className="table-row" key={row.employeeId}><strong>{row.employeeName}</strong><span>{row.ticketsSold}</span><span>{money(row.refundedCents)}</span><span>{money(row.netCollectedCents)}</span></div>)}</div>
      {revenue.salesOperators.length === 0 && <p className="dashboard-empty">No staff-assisted ticket sales in this range.</p>}
      <h3>Top-selling concessions</h3><div className="management-table"><div className="table-row table-head"><span>Item</span><span>Units</span><span>Sales value</span><span>Average unit</span></div>{revenue.concessionTopSellers.map((row) => <div className="table-row" key={row.menuItemId}><strong>{row.name}</strong><span>{row.unitsSold}</span><span>{money(row.salesCents)}</span><span>{money(row.unitsSold ? Math.round(row.salesCents / row.unitsSold) : 0)}</span></div>)}</div>
      {revenue.concessionTopSellers.length === 0 && <p className="dashboard-empty">No sent concession items in this range.</p>}
      <h3>Daily performance</h3><div className="management-table"><div className="table-row table-head"><span>Business date</span><span>Tickets</span><span>Net revenue</span><span>Average patron spend</span></div>{revenue.dailyPerformance.map((row) => <div className="table-row" key={row.date}><strong>{new Date(`${row.date}T12:00:00`).toLocaleDateString()}</strong><span>{row.ticketsSold}</span><span>{money(row.combinedRevenueCents)}</span><span>{money(row.averageTotalSpendPerPatronCents)}</span></div>)}</div>
      {revenue.dailyPerformance.length === 0 && <p className="dashboard-empty">No completed sales in this range.</p>}
    </section>}

    {audienceOrigins && <section className="panel"><p className="kicker">AUDIENCE</p><h2>Where ticket buyers come from</h2>
      <p>Aggregated from optional ZIP codes on completed ticket orders. Customer identities are never included.</p>
      <div className="stats"><div><strong>{audienceOrigins.totals.ordersWithZip}</strong><span>Orders with ZIP</span></div><div><strong>{audienceOrigins.totals.ticketsWithZip}</strong><span>Tickets represented</span></div><div><strong>{audienceOrigins.totals.coveragePercent}%</strong><span>Order coverage</span></div></div>
      <div className="management-table"><div className="table-row table-head"><span>ZIP code</span><span>Orders</span><span>Tickets</span><span>Share of identified tickets</span></div>{audienceOrigins.origins.map((row) => <div className="table-row" key={row.zipCode}><strong>{row.zipCode}</strong><span>{row.orders}</span><span>{row.tickets}</span><span>{row.sharePercent}%</span></div>)}</div>
      {audienceOrigins.origins.length === 0 && <p className="dashboard-empty">No completed orders in this range include a ZIP code yet.</p>}
    </section>}

    {labor && <section className="panel labor-report"><p className="kicker">LABOR</p><h2>Hours</h2><p><strong>{(labor.totalMinutes / 60).toFixed(2)}</strong> total hours</p><button className="primary" onClick={() => void exportHours()}>Export CSV</button><div className="management-table"><div className="table-row table-head"><span>Employee</span><span>Roles</span><span>Clock in</span><span>Hours</span></div>{labor.rows.map((row) => <div className="table-row" key={row.shiftId}><strong>{row.employeeName}</strong><span>{row.roles.join(", ")}</span><span>{new Date(row.clockInAt).toLocaleString()}</span><span className="labor-hours">{(row.workedMinutes / 60).toFixed(2)}{canEditEmployees && <button type="button" className="secondary" onClick={() => editShift(row)}>Adjust</button>}</span></div>)}</div>
      {shiftDraft && <form className="shift-adjustment" onSubmit={(event) => void saveShift(event)}><div className="management-heading"><div><p className="kicker">MANAGER CORRECTION</p><h3>{shiftDraft.employeeName}</h3></div><button type="button" className="secondary" onClick={() => setShiftDraft(null)}>Cancel</button></div><div className="shift-adjustment-grid"><label>Clock in<input type="datetime-local" required value={shiftDraft.clockInAt} onChange={(event) => setShiftDraft({ ...shiftDraft, clockInAt: event.target.value })} /></label><label>Clock out<input type="datetime-local" value={shiftDraft.clockOutAt} onChange={(event) => setShiftDraft({ ...shiftDraft, clockOutAt: event.target.value })} /></label><label>Break start<input type="datetime-local" value={shiftDraft.breakStartAt} onChange={(event) => setShiftDraft({ ...shiftDraft, breakStartAt: event.target.value })} /></label><label>Break end<input type="datetime-local" value={shiftDraft.breakEndAt} onChange={(event) => setShiftDraft({ ...shiftDraft, breakEndAt: event.target.value })} /></label></div><label>Correction note<textarea required maxLength={500} value={shiftDraft.notes} onChange={(event) => setShiftDraft({ ...shiftDraft, notes: event.target.value })} placeholder="Why this shift was changed" /></label><button className="primary">Save correction</button></form>}
    </section>}

    {settings && section === "branding" && <>
      <BrandingSummary settings={settings} onSave={saveBranding} />
      <CustomerSiteCopyEditor copy={settings.siteCopy} onSave={saveSiteCopy} />
      <form className="panel location-settings" onSubmit={(event) => void saveMerch(event)}>
        <p className="kicker">MERCHANDISE</p><h2>External shop</h2>
        <p>Publish a link to the cinema’s existing merchandise store. Customers will see a Merch link that opens the shop in a new tab.</p>
        <label>Merchandise shop URL<input type="url" maxLength={2000} value={merchUrl} onChange={(event) => setMerchUrl(event.target.value)} placeholder="https://shop.example.com" /></label>
        <small>Leave this blank to remove Merch from the customer-site navigation.</small>
        <button className="primary">Save and publish shop link</button>
      </form>
    </>}
    {locationDraft && section === "location" && <form className="panel location-settings" onSubmit={(event) => void saveLocation(event)}><p className="kicker">LOCATION</p><h2>Operating settings</h2><p>These values control the public venue identity, scheduling turnover, dining settlement, and staff time clock.</p>
      <div className="location-settings-grid">
        <label>Cinema name<input required maxLength={120} value={locationDraft.name} onChange={(event) => setLocationDraft({ ...locationDraft, name: event.target.value })} /></label>
        <label>Address<input maxLength={500} value={locationDraft.address ?? ""} onChange={(event) => setLocationDraft({ ...locationDraft, address: event.target.value })} /></label>
        <label>Timezone<input required maxLength={100} value={locationDraft.timezone} onChange={(event) => setLocationDraft({ ...locationDraft, timezone: event.target.value })} placeholder="America/Chicago" /></label>
        <label>Currency<input disabled value={locationDraft.currency} /><small>Currency is fixed during onboarding.</small></label>
        <label>Ticket tax (%)<input type="number" min="0" max="100" step="0.01" required value={locationDraft.ticketTaxRateBasisPoints / 100} onChange={(event) => setLocationDraft({ ...locationDraft, ticketTaxRateBasisPoints: Math.round(Number(event.target.value) * 100) })} /></label>
        <label>Pre-show buffer (minutes)<input type="number" min="0" max="240" required value={locationDraft.preShowBufferMinutes} onChange={(event) => setLocationDraft({ ...locationDraft, preShowBufferMinutes: Number(event.target.value) })} /></label>
        <label>Cleaning buffer (minutes)<input type="number" min="15" max="240" required value={locationDraft.cleaningBufferMinutes} onChange={(event) => setLocationDraft({ ...locationDraft, cleaningBufferMinutes: Number(event.target.value) })} /><small>Attend enforces at least 15 minutes.</small></label>
        <label>Drop checks before film ends (minutes)<input type="number" min="0" max="240" required value={locationDraft.checkDropMinutesBeforeEnd} onChange={(event) => setLocationDraft({ ...locationDraft, checkDropMinutesBeforeEnd: Number(event.target.value) })} /></label>
        <label>Auto-settlement grace (minutes)<input type="number" min="0" max="240" required value={locationDraft.autoSettleGraceMinutes} onChange={(event) => setLocationDraft({ ...locationDraft, autoSettleGraceMinutes: Number(event.target.value) })} /></label>
        <label>Auto-settlement tip (%)<input type="number" min="0" max="100" step="0.01" required value={locationDraft.autoSettleTipBasisPoints / 100} onChange={(event) => setLocationDraft({ ...locationDraft, autoSettleTipBasisPoints: Math.round(Number(event.target.value) * 100) })} /></label>
      </div>
      <label className="checkbox"><input type="checkbox" checked={locationDraft.timeClockEnabled} onChange={(event) => setLocationDraft({ ...locationDraft, timeClockEnabled: event.target.checked })} /> Require staff clock-in at this location</label>
      <div className="location-actions"><button className="primary">Save operating settings</button><a className="secondary button-link" href={`${CUSTOMER_WEB_URL}/signage?locationId=${encodeURIComponent(settings!.id)}`} target="_blank" rel="noreferrer">Open lobby display</a></div>
    </form>}
    {settings && section === "promotions" && <section className="panel promotions-manager"><p className="kicker">PROMOTIONS</p><h2>Discount codes</h2><p>Create a fixed discount, percentage discount, or complimentary-ticket code. Date windows are optional.</p>
      <form className="promotion-form" onSubmit={(event) => void createPromotion(event)}>
        <label>Code<input required maxLength={50} value={promotion.code} onChange={(event) => setPromotion({ ...promotion, code: event.target.value.toUpperCase() })} placeholder="SUMMER20" /></label>
        <label>Name<input required maxLength={100} value={promotion.name} onChange={(event) => setPromotion({ ...promotion, name: event.target.value })} placeholder="Summer member offer" /></label>
        <label>Discount type<select value={promotion.type} onChange={(event) => setPromotion({ ...promotion, type: event.target.value as PromotionType, value: 0 })}><option value="FIXED_AMOUNT">Fixed amount</option><option value="PERCENTAGE">Percentage</option><option value="COMP">Complimentary</option></select></label>
        {promotion.type !== "COMP" && <label>{promotion.type === "FIXED_AMOUNT" ? "Amount ($)" : "Percentage (%)"}<input type="number" min="0.01" max={promotion.type === "PERCENTAGE" ? 100 : undefined} step="0.01" required value={promotion.value || ""} onChange={(event) => setPromotion({ ...promotion, value: Number(event.target.value) })} /></label>}
        <label>Minimum ticket subtotal ($)<input type="number" min="0" step="0.01" value={promotion.minimumSubtotal || ""} onChange={(event) => setPromotion({ ...promotion, minimumSubtotal: Number(event.target.value) })} placeholder="No minimum" /></label>
        <label>Maximum redemptions<input type="number" min="1" step="1" value={promotion.maximumRedemptions || ""} onChange={(event) => setPromotion({ ...promotion, maximumRedemptions: Number(event.target.value) })} placeholder="Unlimited" /></label>
        <label>Starts (optional)<input type="datetime-local" value={promotion.startsAt} onChange={(event) => setPromotion({ ...promotion, startsAt: event.target.value })} /></label>
        <label>Ends (optional)<input type="datetime-local" value={promotion.endsAt} onChange={(event) => setPromotion({ ...promotion, endsAt: event.target.value })} /></label>
        <button className="primary">Create promotion</button>
      </form>
      {canReports && <section className="segment-preview"><p className="kicker">CUSTOMER SEGMENT</p><h3>Win-back audience preview</h3><p>Find registered customers whose most recent completed ticket purchase was on or before a chosen date. This preview does not send or enroll anyone in marketing.</p><form className="report-range" onSubmit={(event) => void previewCustomerSegment(event)}><label>Last purchased on or before<input type="date" required value={inactiveSince} onChange={(event) => setInactiveSince(event.target.value)} /></label><button className="secondary">Preview customers</button></form>{customerSegment && <><p><strong>{customerSegment.total}</strong> matching customers</p><div className="management-table"><div className="table-row table-head"><span>Customer</span><span>Last purchase</span><span>Order</span><span>Total</span></div>{customerSegment.preview.map((customer) => <div className="table-row" key={customer.id}><strong>{customer.name}<small>{customer.email}</small></strong><span>{new Date(customer.lastPurchaseAt).toLocaleDateString()}</span><span>{customer.lastOrderNumber}</span><span>{money(customer.lastOrderTotalCents)}</span></div>)}</div>{customerSegment.total > customerSegment.preview.length && <small>Showing the first {customerSegment.preview.length} customers.</small>}</>}</section>}
      <div className="promotion-list">{settings.promotions.map((item) => <article key={item.id}><div><strong>{item.code}</strong><span>{item.name}</span><small>{item.redemptionCount}{item.maximumRedemptions ? ` / ${item.maximumRedemptions}` : ""} redemptions · {item.discountedTicketCount} tickets · {money(item.totalTicketFaceValueCents)} face value · {money(item.totalCollectedCents)} collected · {money(item.totalDiscountCents)} discounted</small></div><b>{item.type === "FIXED_AMOUNT" ? money(item.amountCents ?? 0) : item.type === "PERCENTAGE" ? `${((item.percentageBasisPoints ?? 0) / 100).toFixed(2).replace(/\.00$/, "")}%` : "Comp"}<small>{item.minimumSubtotalCents ? `${money(item.minimumSubtotalCents)} minimum` : "No minimum"}</small></b><span>{item.startsAt ? new Date(item.startsAt).toLocaleString() : "Immediately"} → {item.endsAt ? new Date(item.endsAt).toLocaleString() : "No end date"}</span><div className="promotion-actions"><button type="button" className="secondary" onClick={() => setPromotionEdit({ id: item.id, draft: promotionDraft(item) })}>Edit</button><button type="button" className="secondary" onClick={() => void togglePromotion(item)}>{item.active ? "Deactivate" : "Activate"}</button></div></article>)}</div>
      {promotionEdit && <form className="promotion-form" onSubmit={(event) => void savePromotion(event)}>
        <div className="management-heading"><div><p className="kicker">EDIT PROMOTION</p><h3>{promotionEdit.draft.code}</h3></div><button type="button" className="secondary" onClick={() => setPromotionEdit(null)}>Cancel</button></div>
        <label>Code<input required maxLength={50} value={promotionEdit.draft.code} onChange={(event) => setPromotionEdit({ ...promotionEdit, draft: { ...promotionEdit.draft, code: event.target.value.toUpperCase() } })} /></label>
        <label>Name<input required maxLength={100} value={promotionEdit.draft.name} onChange={(event) => setPromotionEdit({ ...promotionEdit, draft: { ...promotionEdit.draft, name: event.target.value } })} /></label>
        <label>Discount type<select value={promotionEdit.draft.type} onChange={(event) => setPromotionEdit({ ...promotionEdit, draft: { ...promotionEdit.draft, type: event.target.value as PromotionType, value: 0 } })}><option value="FIXED_AMOUNT">Fixed amount</option><option value="PERCENTAGE">Percentage</option><option value="COMP">Complimentary</option></select></label>
        {promotionEdit.draft.type !== "COMP" && <label>{promotionEdit.draft.type === "FIXED_AMOUNT" ? "Amount ($)" : "Percentage (%)"}<input type="number" min="0.01" max={promotionEdit.draft.type === "PERCENTAGE" ? 100 : undefined} step="0.01" required value={promotionEdit.draft.value || ""} onChange={(event) => setPromotionEdit({ ...promotionEdit, draft: { ...promotionEdit.draft, value: Number(event.target.value) } })} /></label>}
        <label>Minimum ticket subtotal ($)<input type="number" min="0" step="0.01" value={promotionEdit.draft.minimumSubtotal || ""} onChange={(event) => setPromotionEdit({ ...promotionEdit, draft: { ...promotionEdit.draft, minimumSubtotal: Number(event.target.value) } })} placeholder="No minimum" /></label>
        <label>Maximum redemptions<input type="number" min="1" step="1" value={promotionEdit.draft.maximumRedemptions || ""} onChange={(event) => setPromotionEdit({ ...promotionEdit, draft: { ...promotionEdit.draft, maximumRedemptions: Number(event.target.value) } })} placeholder="Unlimited" /></label>
        <label>Starts (optional)<input type="datetime-local" value={promotionEdit.draft.startsAt} onChange={(event) => setPromotionEdit({ ...promotionEdit, draft: { ...promotionEdit.draft, startsAt: event.target.value } })} /></label>
        <label>Ends (optional)<input type="datetime-local" value={promotionEdit.draft.endsAt} onChange={(event) => setPromotionEdit({ ...promotionEdit, draft: { ...promotionEdit.draft, endsAt: event.target.value } })} /></label>
        <button className="primary">Save promotion</button>
      </form>}
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
      {auditHasMore && <button type="button" className="secondary audit-load-more" onClick={() => void refresh(true)}>Load older activity</button>}
    </section>}
  </section>;
}
