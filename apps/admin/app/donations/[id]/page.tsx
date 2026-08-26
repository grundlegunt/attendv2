"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAdminSession } from "../../admin-session";
import { apiDownload, apiFetch, ApiRequestError } from "../../lib/api-client";

type Period = "all" | "30" | "90" | "365";
type CampaignPerformance = {
  campaign: { id: string; name: string; description: string | null; goalAmountCents: number | null; startsAt: string | null; endsAt: string | null; active: boolean };
  location: { name: string; timezone: string; currency: string };
  totals: { contributions: number; raisedAmountCents: number; taxDeductibleAmountCents: number; averageContributionCents: number; refundedContributions: number; refundedAmountCents: number; goalProgressPercent: number | null };
  donations: Array<{ id: string; donorName: string | null; donorEmail: string | null; amountCents: number; taxDeductibleAmountCents: number; paymentMethod: string; status: string; receivedAt: string; customer: { id: string; name: string | null; email: string | null } | null }>;
};

function money(cents: number, currency: string) { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100); }

export default function DonationCampaignPage() {
  const { id } = useParams<{ id: string }>();
  const { accessToken, employee } = useAdminSession();
  const canManage = employee.permissions.includes("ticket.price.edit");
  const [period, setPeriod] = useState<Period>("all");
  const [data, setData] = useState<CampaignPerformance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [updating, setUpdating] = useState(false);
  const updateRequestId = useRef<string | null>(null);
  const query = useMemo(() => {
    if (period === "all") return "";
    const to = new Date(); const from = new Date(to.getTime() - Number(period) * 24 * 60 * 60 * 1000);
    return new URLSearchParams({ from: from.toISOString(), to: to.toISOString() }).toString();
  }, [period]);
  const path = `/management/donation-campaigns/${encodeURIComponent(id)}${query ? `?${query}` : ""}`;

  useEffect(() => {
    let cancelled = false; setLoading(true); setError(null);
    apiFetch<CampaignPerformance>(path, { accessToken }).then((result) => { if (!cancelled) setData(result); }).catch((reason) => { if (!cancelled) setError(reason instanceof ApiRequestError ? reason.body.message : "Campaign performance could not be loaded."); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accessToken, path]);

  async function exportCsv() {
    if (!data || exporting) return; setExporting(true); setError(null);
    try {
      const parameters = new URLSearchParams(query); parameters.set("campaignId", id);
      const blob = await apiDownload(`/management/donations.csv?${parameters.toString()}`, { accessToken });
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `${data.campaign.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "campaign"}-donations.csv`; anchor.click(); URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "Campaign donations could not be exported."); }
    finally { setExporting(false); }
  }

  async function toggleCampaign() {
    if (!data || updating) return; setUpdating(true); setError(null);
    updateRequestId.current ??= crypto.randomUUID();
    try {
      await apiFetch(`/management/donation-campaigns/${encodeURIComponent(id)}`, { method: "PATCH", accessToken, headers: { "Idempotency-Key": updateRequestId.current }, body: JSON.stringify({ active: !data.campaign.active }) });
      updateRequestId.current = null; setData({ ...data, campaign: { ...data.campaign, active: !data.campaign.active } });
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "Campaign status could not be updated."); }
    finally { setUpdating(false); }
  }

  const currency = data?.location.currency ?? "USD";
  const timeZone = data?.location.timezone ?? employee.timezone;
  const date = (value: string) => new Date(value).toLocaleDateString([], { timeZone, month: "short", day: "numeric", year: "numeric" });

  return <main className="admin-route-page donation-campaign-page">
    <Link href="/donations" className="back-link">← All donations</Link>
    <header className="admin-page-heading"><div><p className="kicker">DONATION CAMPAIGN</p><h1>{data?.campaign.name ?? "Campaign performance"}</h1><p>{data?.campaign.description || "Fundraising progress and contribution activity for this campaign."}</p></div>{data && <div className="donation-campaign-actions"><button className="secondary" type="button" disabled={exporting} onClick={() => void exportCsv()}>{exporting ? "Exporting…" : "Export CSV"}</button>{canManage && <button className="secondary" type="button" disabled={updating} onClick={() => void toggleCampaign()}>{updating ? "Updating…" : data.campaign.active ? "Deactivate" : "Reactivate"}</button>}</div>}</header>
    <div className="series-period-switch" role="group" aria-label="Reporting period">{(["all", "30", "90", "365"] as Period[]).map((value) => <button type="button" className={period === value ? "active" : ""} onClick={() => setPeriod(value)} key={value}>{value === "all" ? "All time" : `${value} days`}</button>)}</div>
    {error && <div className="error-banner" role="alert">{error}</div>}{loading && <p className="dashboard-empty">Loading campaign performance…</p>}
    {data && <><section className="donation-campaign-metrics"><article className="panel"><span>Raised</span><strong>{money(data.totals.raisedAmountCents, currency)}</strong><small>{data.totals.goalProgressPercent === null ? "No campaign goal" : `${data.totals.goalProgressPercent}% of ${money(data.campaign.goalAmountCents!, currency)}`}</small></article><article className="panel"><span>Contributions</span><strong>{data.totals.contributions}</strong><small>{money(data.totals.averageContributionCents, currency)} average gift</small></article><article className="panel"><span>Tax deductible</span><strong>{money(data.totals.taxDeductibleAmountCents, currency)}</strong><small>{data.totals.refundedContributions} refunded · {money(data.totals.refundedAmountCents, currency)}</small></article><article className="panel"><span>Status</span><strong>{data.campaign.active ? "Active" : "Inactive"}</strong><small>{data.campaign.startsAt ? date(data.campaign.startsAt) : "No start date"} – {data.campaign.endsAt ? date(data.campaign.endsAt) : "No end date"}</small></article></section>
      <section className="panel donation-history"><div className="dashboard-section-heading"><div><p className="kicker">CONTRIBUTIONS</p><h2>Campaign activity</h2></div><span>{data.donations.length} recent records</span></div><div className="donation-history-table"><header><span>Date</span><span>Donor</span><span>Status</span><span>Method</span><span>Amount</span><span>Deductible</span></header>{data.donations.map((donation) => <div key={donation.id}><span>{date(donation.receivedAt)}</span><span><strong>{donation.customer?.name || donation.donorName || "Anonymous"}</strong><small>{donation.customer?.email || donation.donorEmail || "No email"}</small></span><span>{donation.status.toLowerCase()}</span><span>{donation.paymentMethod.toLowerCase()}</span><span>{money(donation.amountCents, currency)}</span><span>{money(donation.taxDeductibleAmountCents, currency)}</span></div>)}</div>{data.donations.length === 0 && <p className="dashboard-empty">No contributions in this period.</p>}</section></>}
  </main>;
}
