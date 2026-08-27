"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useAdminSession } from "../admin-session";
import { apiDownload, apiFetch, ApiRequestError } from "../lib/api-client";
import { localDateInputValue } from "../report-range";

type Counts = Record<"Pageview" | "Seat Selection Continued" | "Checkout Started" | "Payment Form Ready" | "Checkout Completed" | "Account Created" | "Gift Card Started" | "Gift Card Purchased" | "Membership Checkout Started" | "Membership Activated" | "Donation Checkout Started" | "Donation Completed" | "Private Event Inquiry Submitted" | "Waitlist Joined", number>;
type Rates = { seatToCheckoutRatePercent: number | null; paymentFormReadyRatePercent: number | null; paymentCompletionRatePercent: number | null; checkoutCompletionRatePercent: number | null; giftCardCompletionRatePercent: number | null; membershipCompletionRatePercent: number | null; donationCompletionRatePercent: number | null };
type Report = { generatedAt: string; range: { from: string; to: string }; totals: Counts & Rates; comparison: { range: { from: string; to: string }; totals: Counts & Rates }; daily: Array<{ date: string } & Counts>; pages: Array<{ path: string; count: number }> };

const rate = (value: number | null) => value === null ? "No starts" : `${value.toFixed(2)}%`;
const countChange = (current: number, prior: number) => `${current - prior >= 0 ? "+" : ""}${(current - prior).toLocaleString()} vs prior period`;
const rateChange = (current: number | null, prior: number | null) => current === null || prior === null ? "No comparable rate" : `${current - prior >= 0 ? "+" : ""}${(current - prior).toFixed(2)} points vs prior period`;
const funnelChange = (currentCount: number, priorCount: number, currentRate?: number | null, priorRate?: number | null) => {
  const counts = countChange(currentCount, priorCount);
  return currentRate === undefined || priorRate === undefined ? counts : `${counts} · ${rateChange(currentRate, priorRate)}`;
};

export default function AudiencePage() {
  const { accessToken, employee } = useAdminSession();
  const timeZone = employee.timezone;
  const [from, setFrom] = useState(() => localDateInputValue(new Date(Date.now() - 29 * 86_400_000), timeZone));
  const [through, setThrough] = useState(() => localDateInputValue(new Date(), timeZone));
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  async function load() {
    const requestId = ++requestRef.current;
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ from, to: through });
      const next = await apiFetch<Report>(`/reports/audience-analytics?${params}`, { accessToken });
      if (requestId === requestRef.current) setReport(next);
    } catch (reason) {
      if (requestId === requestRef.current) setError(reason instanceof ApiRequestError ? reason.body.message : reason instanceof Error ? reason.message : "Website analytics could not be loaded.");
    } finally { if (requestId === requestRef.current) setLoading(false); }
  }
  async function download() {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ from, to: through });
      const blob = await apiDownload(`/reports/audience-analytics.csv?${params}`, { accessToken });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `ringo-website-analytics-${from}-to-${through}.csv`; anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof ApiRequestError ? reason.body.message : reason instanceof Error ? reason.message : "Website analytics could not be exported.");
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); return () => { requestRef.current += 1; }; }, [accessToken, timeZone]);
  const maxDaily = Math.max(1, ...(report?.daily ?? []).map((day) => day.Pageview + day["Checkout Started"] + day["Checkout Completed"]));

  return <main className="admin-shell audience-analytics-page">
    <header className="dashboard-heading"><div><p className="kicker">CUSTOMER WEBSITE</p><h1>Website analytics</h1><p>Privacy-safe activity from customers who allowed optional analytics. Counts are interactions, not unique visitors.</p></div></header>
    <form className="report-range audience-report-range" onSubmit={(event: FormEvent) => { event.preventDefault(); void load(); }}><label>From<input type="date" required value={from} max={through} onChange={(event) => setFrom(event.target.value)} /></label><label>Through<input type="date" required value={through} min={from} onChange={(event) => setThrough(event.target.value)} /></label><button className="primary" disabled={loading}>{loading ? "Loading…" : "Refresh"}</button><button type="button" className="secondary" disabled={loading || !report} onClick={() => void download()}>Export CSV</button></form>
    {error && <div className="error-banner">{error}</div>}
    {report && <>
      <section className="dashboard-metrics audience-overview"><article className="dashboard-metric"><span>Pageviews</span><strong>{report.totals.Pageview.toLocaleString()}</strong><small>{countChange(report.totals.Pageview, report.comparison.totals.Pageview)}</small></article><article className="dashboard-metric"><span>Checkout completion</span><strong>{rate(report.totals.checkoutCompletionRatePercent)}</strong><small>{rateChange(report.totals.checkoutCompletionRatePercent, report.comparison.totals.checkoutCompletionRatePercent)}</small></article><article className="dashboard-metric"><span>Accounts created</span><strong>{report.totals["Account Created"].toLocaleString()}</strong><small>{countChange(report.totals["Account Created"], report.comparison.totals["Account Created"])}</small></article><article className="dashboard-metric"><span>Waitlist joins</span><strong>{report.totals["Waitlist Joined"].toLocaleString()}</strong><small>{countChange(report.totals["Waitlist Joined"], report.comparison.totals["Waitlist Joined"])}</small></article></section>
      <section className="audience-funnel" aria-labelledby="checkout-funnel-heading"><h2 id="checkout-funnel-heading">Ticket checkout funnel</h2><div><article><span>Seats continued</span><strong>{report.totals["Seat Selection Continued"]}</strong><small>{funnelChange(report.totals["Seat Selection Continued"], report.comparison.totals["Seat Selection Continued"])}</small></article><article><span>Checkout created</span><strong>{report.totals["Checkout Started"]}</strong><small>{rate(report.totals.seatToCheckoutRatePercent)} from seats<br />{funnelChange(report.totals["Checkout Started"], report.comparison.totals["Checkout Started"], report.totals.seatToCheckoutRatePercent, report.comparison.totals.seatToCheckoutRatePercent)}</small></article><article><span>Payment ready</span><strong>{report.totals["Payment Form Ready"]}</strong><small>{rate(report.totals.paymentFormReadyRatePercent)} from checkout<br />{funnelChange(report.totals["Payment Form Ready"], report.comparison.totals["Payment Form Ready"], report.totals.paymentFormReadyRatePercent, report.comparison.totals.paymentFormReadyRatePercent)}</small></article><article><span>Completed</span><strong>{report.totals["Checkout Completed"]}</strong><small>{rate(report.totals.paymentCompletionRatePercent)} from payment<br />{funnelChange(report.totals["Checkout Completed"], report.comparison.totals["Checkout Completed"], report.totals.paymentCompletionRatePercent, report.comparison.totals.paymentCompletionRatePercent)}</small></article></div></section>
      <section className="audience-funnel"><h2>Other customer actions</h2><div><article><span>Gift cards purchased</span><strong>{report.totals["Gift Card Purchased"]}</strong><small>{rate(report.totals.giftCardCompletionRatePercent)} completion<br />{funnelChange(report.totals["Gift Card Purchased"], report.comparison.totals["Gift Card Purchased"], report.totals.giftCardCompletionRatePercent, report.comparison.totals.giftCardCompletionRatePercent)}</small></article><article><span>Memberships activated</span><strong>{report.totals["Membership Activated"]}</strong><small>{rate(report.totals.membershipCompletionRatePercent)} completion<br />{funnelChange(report.totals["Membership Activated"], report.comparison.totals["Membership Activated"], report.totals.membershipCompletionRatePercent, report.comparison.totals.membershipCompletionRatePercent)}</small></article><article><span>Donations completed</span><strong>{report.totals["Donation Completed"]}</strong><small>{rate(report.totals.donationCompletionRatePercent)} completion<br />{funnelChange(report.totals["Donation Completed"], report.comparison.totals["Donation Completed"], report.totals.donationCompletionRatePercent, report.comparison.totals.donationCompletionRatePercent)}</small></article><article><span>Private-event inquiries</span><strong>{report.totals["Private Event Inquiry Submitted"]}</strong><small>{funnelChange(report.totals["Private Event Inquiry Submitted"], report.comparison.totals["Private Event Inquiry Submitted"])}</small></article></div></section>
      <div className="audience-detail-grid"><section className="panel"><p className="kicker">TREND</p><h2>Daily customer activity</h2><div className="audience-trend">{report.daily.length === 0 && <p className="dashboard-empty">No consented activity in this range.</p>}{report.daily.map((day) => { const activity = day.Pageview + day["Checkout Started"] + day["Checkout Completed"]; return <div key={day.date}><time>{new Date(`${day.date}T12:00:00Z`).toLocaleDateString([], { timeZone: "UTC", month: "short", day: "numeric" })}</time><i><span style={{ width: `${activity / maxDaily * 100}%` }} /></i><strong>{day.Pageview}<small> views</small></strong><strong>{day["Checkout Completed"]}<small> sales</small></strong></div>; })}</div></section><section className="panel"><p className="kicker">CONTENT</p><h2>Top pages</h2><div className="audience-pages">{report.pages.length === 0 && <p className="dashboard-empty">No consented pageviews in this range.</p>}{report.pages.map((page) => <div key={page.path}><code>{page.path}</code><strong>{page.count.toLocaleString()}</strong></div>)}</div></section></div>
      <p className="dashboard-updated">Cinema-local daily totals · updated {new Date(report.generatedAt).toLocaleString()}</p>
    </>}
  </main>;
}
