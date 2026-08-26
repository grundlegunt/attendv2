"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useAdminSession } from "../admin-session";
import { apiDownload, apiFetch, ApiRequestError } from "../lib/api-client";
import { inclusiveReportRange } from "../report-range";

type Campaign = { id: string; name: string; description: string | null; goalAmountCents: number | null; active: boolean; raisedAmountCents: number; taxDeductibleAmountCents: number; _count: { donations: number } };
type Donation = { id: string; donorName: string | null; donorEmail: string | null; amountCents: number; taxDeductibleAmountCents: number; paymentMethod: string; status: string; receivedAt: string; campaign: { id: string; name: string } | null; customer: { id: string; name: string | null; email: string | null } | null };
type DonationData = { campaigns: Campaign[]; donations: Donation[]; summary: { count: number; amountCents: number; taxDeductibleAmountCents: number } };
type DonationFilters = { campaignId: string; from: string; through: string };

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const cents = (value: string) => Math.round(Number(value) * 100);

function donationReportPath(path: string, filters: DonationFilters, timeZone: string) {
  const search = new URLSearchParams();
  if (filters.campaignId) search.set("campaignId", filters.campaignId);
  if (filters.from && filters.through) {
    const range = inclusiveReportRange(filters.from, filters.through, timeZone);
    search.set("from", range.from);
    search.set("to", range.to);
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export default function DonationsPage() {
  const { accessToken, employee } = useAdminSession();
  const canManage = employee.permissions.includes("ticket.price.edit");
  const [data, setData] = useState<DonationData>({ campaigns: [], donations: [], summary: { count: 0, amountCents: 0, taxDeductibleAmountCents: 0 } });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [goal, setGoal] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [donorName, setDonorName] = useState("");
  const [donorEmail, setDonorEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [deductible, setDeductible] = useState("");
  const [method, setMethod] = useState<"CASH" | "CHECK" | "EXTERNAL">("CHECK");
  const [filterCampaignId, setFilterCampaignId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [throughDate, setThroughDate] = useState("");
  const [appliedFilters, setAppliedFilters] = useState<DonationFilters>({ campaignId: "", from: "", through: "" });

  const load = useCallback(async () => {
    try { setData(await apiFetch<DonationData>(donationReportPath("/management/donations", appliedFilters, employee.timezone), { accessToken })); }
    catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "Donation records could not be loaded."); }
  }, [accessToken, appliedFilters, employee.timezone]);
  useEffect(() => { void load(); }, [load]);

  async function createCampaign(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      await apiFetch("/management/donation-campaigns", { method: "POST", accessToken, headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ name: campaignName, goalAmountCents: goal ? cents(goal) : null, active: true }) });
      setCampaignName(""); setGoal(""); await load();
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "Campaign could not be created."); }
    finally { setBusy(false); }
  }

  async function recordDonation(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      await apiFetch("/management/donations", { method: "POST", accessToken, headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ campaignId: campaignId || null, donorName: donorName || null, donorEmail: donorEmail || null, amountCents: cents(amount), taxDeductibleAmountCents: cents(deductible || amount), paymentMethod: method, receivedAt: new Date().toISOString() }) });
      setDonorName(""); setDonorEmail(""); setAmount(""); setDeductible(""); await load();
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "Donation could not be recorded."); }
    finally { setBusy(false); }
  }

  async function exportCsv() {
    setError(null);
    try {
      const blob = await apiDownload(donationReportPath("/management/donations.csv", appliedFilters, employee.timezone), { accessToken });
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "donations.csv"; anchor.click(); URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "The donation export could not be downloaded."); }
  }

  function applyFilters(event: FormEvent) {
    event.preventDefault(); setError(null);
    if (Boolean(fromDate) !== Boolean(throughDate)) {
      setError("Choose both a From and Through date, or leave both blank."); return;
    }
    try {
      if (fromDate && throughDate) inclusiveReportRange(fromDate, throughDate, employee.timezone);
      setAppliedFilters({ campaignId: filterCampaignId, from: fromDate, through: throughDate });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Choose a valid report date range."); }
  }

  function clearFilters() {
    setFilterCampaignId(""); setFromDate(""); setThroughDate(""); setError(null);
    setAppliedFilters({ campaignId: "", from: "", through: "" });
  }

  return <main className="admin-route-page donations-page">
    <header className="admin-page-heading"><div><p className="kicker">NONPROFIT DEVELOPMENT</p><h1>Donations</h1><p>Track campaigns and settled contributions separately from ticket and concession revenue.</p></div><button className="secondary" type="button" onClick={() => void exportCsv()}>Export CSV</button></header>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <form className="panel donation-report-filters" onSubmit={applyFilters}><div><p className="kicker">REPORT FILTERS</p><h2>Donation activity</h2><p>Filters apply to the totals, contribution activity, and CSV export.</p></div><label>Campaign<select value={filterCampaignId} onChange={(event) => setFilterCampaignId(event.target.value)}><option value="">All campaigns and general support</option>{data.campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label><label>From<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label>Through<input type="date" value={throughDate} onChange={(event) => setThroughDate(event.target.value)} /></label><div className="donation-filter-actions"><button type="submit">Apply filters</button><button className="secondary" type="button" onClick={clearFilters}>Clear</button></div></form>
    <section className="donation-metrics"><article className="panel"><span>Raised</span><strong>{money(data.summary.amountCents)}</strong></article><article className="panel"><span>Contributions</span><strong>{data.summary.count}</strong></article><article className="panel"><span>Tax deductible</span><strong>{money(data.summary.taxDeductibleAmountCents)}</strong></article></section>
    <section className="donation-workspace">
      <div className="panel"><div className="dashboard-section-heading"><div><p className="kicker">CAMPAIGNS</p><h2>Fundraising programs</h2></div></div>
        <div className="donation-campaign-list">{data.campaigns.map((campaign) => <article key={campaign.id}><div><strong>{campaign.name}</strong><span>{campaign.active ? "Active" : "Inactive"} · {campaign._count.donations} contributions</span></div><div><strong>{money(campaign.raisedAmountCents)}</strong><span>{campaign.goalAmountCents ? `of ${money(campaign.goalAmountCents)}` : "No goal"}</span></div></article>)}</div>
        {!data.campaigns.length && <p className="dashboard-empty">No donation campaigns yet.</p>}
        {canManage && <form className="donation-form" onSubmit={createCampaign}><h3>Create campaign</h3><label>Name<input required maxLength={120} value={campaignName} onChange={(event) => setCampaignName(event.target.value)} /></label><label>Goal (optional)<input inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="25000.00" /></label><button disabled={busy}>Create campaign</button></form>}
      </div>
      <form className="panel donation-form" onSubmit={recordDonation}><p className="kicker">OFFLINE CONTRIBUTION</p><h2>Record a settled donation</h2><p className="muted">Use this for cash, checks, or payments processed outside Ringo. Donations completed through the public checkout are recorded automatically.</p><label>Campaign<select value={campaignId} onChange={(event) => setCampaignId(event.target.value)}><option value="">General support</option>{data.campaigns.filter((campaign) => campaign.active).map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label><label>Donor name<input maxLength={120} value={donorName} onChange={(event) => setDonorName(event.target.value)} /></label><label>Donor email<input type="email" maxLength={320} value={donorEmail} onChange={(event) => setDonorEmail(event.target.value)} /></label><div className="donation-form-row"><label>Amount<input required inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label>Tax-deductible amount<input inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={deductible} onChange={(event) => setDeductible(event.target.value)} placeholder={amount || "0.00"} /></label></div><label>Payment method<select value={method} onChange={(event) => setMethod(event.target.value as typeof method)}><option value="CHECK">Check</option><option value="CASH">Cash</option><option value="EXTERNAL">External processor</option></select></label><button disabled={busy}>{busy ? "Saving…" : "Record donation"}</button></form>
    </section>
    <section className="panel donation-history"><div className="dashboard-section-heading"><div><p className="kicker">CONTRIBUTIONS</p><h2>Recent donation activity</h2></div><span>{data.donations.length} shown</span></div><div className="donation-history-table"><header><span>Date</span><span>Donor</span><span>Campaign</span><span>Method</span><span>Amount</span><span>Deductible</span></header>{data.donations.map((donation) => <div key={donation.id}><span>{new Date(donation.receivedAt).toLocaleDateString([], { timeZone: employee.timezone })}</span><span><strong>{donation.customer?.name || donation.donorName || "Anonymous"}</strong><small>{donation.customer?.email || donation.donorEmail || "No email"}</small></span><span>{donation.campaign?.name || "General support"}</span><span>{donation.paymentMethod.toLowerCase()}</span><span>{money(donation.amountCents)}</span><span>{money(donation.taxDeductibleAmountCents)}</span></div>)}</div>{!data.donations.length && <p className="dashboard-empty">No donations have been recorded.</p>}</section>
  </main>;
}
