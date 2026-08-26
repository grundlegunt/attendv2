"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useAdminSession } from "../admin-session";
import { apiFetch, ApiRequestError } from "../lib/api-client";

type Campaign = { id: string; name: string; description: string | null; goalAmountCents: number | null; active: boolean; raisedAmountCents: number; taxDeductibleAmountCents: number; _count: { donations: number } };
type Donation = { id: string; donorName: string | null; donorEmail: string | null; amountCents: number; taxDeductibleAmountCents: number; paymentMethod: string; status: string; receivedAt: string; campaign: { id: string; name: string } | null; customer: { id: string; name: string | null; email: string | null } | null };
type DonationData = { campaigns: Campaign[]; donations: Donation[]; summary: { count: number; amountCents: number; taxDeductibleAmountCents: number } };

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const cents = (value: string) => Math.round(Number(value) * 100);

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

  const load = useCallback(async () => {
    try { setData(await apiFetch<DonationData>("/management/donations", { accessToken })); }
    catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "Donation records could not be loaded."); }
  }, [accessToken]);
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

  return <main className="admin-route-page donations-page">
    <header className="admin-page-heading"><div><p className="kicker">NONPROFIT DEVELOPMENT</p><h1>Donations</h1><p>Track campaigns and settled contributions separately from ticket and concession revenue.</p></div></header>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <section className="donation-metrics"><article className="panel"><span>Raised</span><strong>{money(data.summary.amountCents)}</strong></article><article className="panel"><span>Contributions</span><strong>{data.summary.count}</strong></article><article className="panel"><span>Tax deductible</span><strong>{money(data.summary.taxDeductibleAmountCents)}</strong></article></section>
    <section className="donation-workspace">
      <div className="panel"><div className="dashboard-section-heading"><div><p className="kicker">CAMPAIGNS</p><h2>Fundraising programs</h2></div></div>
        <div className="donation-campaign-list">{data.campaigns.map((campaign) => <article key={campaign.id}><div><strong>{campaign.name}</strong><span>{campaign.active ? "Active" : "Inactive"} · {campaign._count.donations} contributions</span></div><div><strong>{money(campaign.raisedAmountCents)}</strong><span>{campaign.goalAmountCents ? `of ${money(campaign.goalAmountCents)}` : "No goal"}</span></div></article>)}</div>
        {!data.campaigns.length && <p className="dashboard-empty">No donation campaigns yet.</p>}
        {canManage && <form className="donation-form" onSubmit={createCampaign}><h3>Create campaign</h3><label>Name<input required maxLength={120} value={campaignName} onChange={(event) => setCampaignName(event.target.value)} /></label><label>Goal (optional)<input inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="25000.00" /></label><button disabled={busy}>Create campaign</button></form>}
      </div>
      <form className="panel donation-form" onSubmit={recordDonation}><p className="kicker">OFFLINE CONTRIBUTION</p><h2>Record a settled donation</h2><p className="muted">Use this for cash, checks, or payments processed outside Ringo. Online checkout donations will be recorded automatically in a later step.</p><label>Campaign<select value={campaignId} onChange={(event) => setCampaignId(event.target.value)}><option value="">General support</option>{data.campaigns.filter((campaign) => campaign.active).map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label><label>Donor name<input maxLength={120} value={donorName} onChange={(event) => setDonorName(event.target.value)} /></label><label>Donor email<input type="email" maxLength={320} value={donorEmail} onChange={(event) => setDonorEmail(event.target.value)} /></label><div className="donation-form-row"><label>Amount<input required inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label>Tax-deductible amount<input inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={deductible} onChange={(event) => setDeductible(event.target.value)} placeholder={amount || "0.00"} /></label></div><label>Payment method<select value={method} onChange={(event) => setMethod(event.target.value as typeof method)}><option value="CHECK">Check</option><option value="CASH">Cash</option><option value="EXTERNAL">External processor</option></select></label><button disabled={busy}>{busy ? "Saving…" : "Record donation"}</button></form>
    </section>
    <section className="panel donation-history"><div className="dashboard-section-heading"><div><p className="kicker">CONTRIBUTIONS</p><h2>Recent donation activity</h2></div><span>{data.donations.length} shown</span></div><div className="donation-history-table"><header><span>Date</span><span>Donor</span><span>Campaign</span><span>Method</span><span>Amount</span><span>Deductible</span></header>{data.donations.map((donation) => <div key={donation.id}><span>{new Date(donation.receivedAt).toLocaleDateString([], { timeZone: employee.timezone })}</span><span><strong>{donation.customer?.name || donation.donorName || "Anonymous"}</strong><small>{donation.customer?.email || donation.donorEmail || "No email"}</small></span><span>{donation.campaign?.name || "General support"}</span><span>{donation.paymentMethod.toLowerCase()}</span><span>{money(donation.amountCents)}</span><span>{money(donation.taxDeductibleAmountCents)}</span></div>)}</div>{!data.donations.length && <p className="dashboard-empty">No donations have been recorded.</p>}</section>
  </main>;
}
