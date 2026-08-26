"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useAdminSession } from "../admin-session";
import { apiDownload, apiFetch, ApiRequestError } from "../lib/api-client";

type Status = "" | "ACTIVE" | "EXPIRED" | "SUSPENDED" | "CANCELED";
type Lifecycle = "" | "EXPIRING" | "LAPSED";
type Membership = { id: string; membershipNumber: string; tier: string; status: Exclude<Status, "">; expiresAt: string | null; updatedAt: string; customer: { id: string; name: string | null; email: string | null; phone: string | null } };
type Plan = { id: string; name: string; description: string | null; priceCents: number; durationMonths: number; benefits: unknown; autoRenew: boolean; active: boolean; _count: { memberships: number } };
type Summary = { active: number; expiringSoon: number; lapsed: number; recentEnrollments: number; collectedAmountCents: number; paidEnrollments: number; currency: string };
type PlanDraft = { name: string; description: string; price: string; duration: string; benefits: string };

export default function MembershipsPage() {
  const { accessToken, employee } = useAdminSession();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("");
  const [lifecycle, setLifecycle] = useState<Lifecycle>("");
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [planName, setPlanName] = useState("");
  const [planDescription, setPlanDescription] = useState("");
  const [planPrice, setPlanPrice] = useState("50.00");
  const [planDuration, setPlanDuration] = useState("12");
  const [planBenefits, setPlanBenefits] = useState("");
  const [planSaving, setPlanSaving] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planDraft, setPlanDraft] = useState<PlanDraft | null>(null);
  const mutationLockRef = useRef(false);
  const planCreateAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const planUpdateAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const planToggleAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);

  const loadPlans = () => apiFetch<Plan[]>("/management/membership-plans", { accessToken }).then(setPlans);
  useEffect(() => {
    void Promise.all([loadPlans(), apiFetch<Summary>("/management/memberships/summary", { accessToken }).then(setSummary)])
      .catch((reason) => setError(reason instanceof ApiRequestError ? reason.body.message : "Membership information could not be loaded."));
  }, [accessToken]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (query.trim()) params.set("query", query.trim());
      if (status) params.set("status", status);
      if (lifecycle) params.set("lifecycle", lifecycle);
      setLoading(true); setError(null);
      apiFetch<Membership[]>(`/management/memberships${params.size ? `?${params}` : ""}`, { accessToken, signal: controller.signal })
        .then(setMemberships)
        .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof ApiRequestError ? reason.body.message : "Memberships could not be loaded."); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [accessToken, query, status, lifecycle]);

  const date = (value: string) => new Date(value).toLocaleDateString([], { timeZone: employee.timezone, month: "short", day: "numeric", year: "numeric" });
  const money = (cents: number, currency = "USD") => new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
  async function createPlan(event: FormEvent) {
    event.preventDefault(); if (mutationLockRef.current) return; mutationLockRef.current = true; setPlanSaving(true); setError(null);
    const payload = { name: planName, description: planDescription || null, priceCents: Math.round(Number(planPrice) * 100), durationMonths: Number(planDuration), benefits: planBenefits.split("\n").map((benefit) => benefit.trim()).filter(Boolean), autoRenew: false, active: true };
    const fingerprint = JSON.stringify(payload);
    if (planCreateAttemptRef.current?.fingerprint !== fingerprint) planCreateAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      await apiFetch("/management/membership-plans", { method: "POST", accessToken, headers: { "Idempotency-Key": planCreateAttemptRef.current.requestId }, body: JSON.stringify(payload) });
      planCreateAttemptRef.current = null; setPlanName(""); setPlanDescription(""); setPlanBenefits(""); await loadPlans();
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "Membership plan could not be created."); } finally { mutationLockRef.current = false; setPlanSaving(false); }
  }
  async function togglePlan(plan: Plan) {
    if (mutationLockRef.current) return;
    mutationLockRef.current = true; setPlanSaving(true);
    setError(null);
    const payload = { active: !plan.active };
    const fingerprint = JSON.stringify({ planId: plan.id, ...payload });
    if (planToggleAttemptRef.current?.fingerprint !== fingerprint) planToggleAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    try { await apiFetch(`/management/membership-plans/${plan.id}`, { method: "PATCH", accessToken, headers: { "Idempotency-Key": planToggleAttemptRef.current.requestId }, body: JSON.stringify(payload) }); planToggleAttemptRef.current = null; await loadPlans(); }
    catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "Membership plan could not be updated."); }
    finally { mutationLockRef.current = false; setPlanSaving(false); }
  }
  function beginPlanEdit(plan: Plan) {
    setEditingPlanId(plan.id);
    setPlanDraft({ name: plan.name, description: plan.description ?? "", price: (plan.priceCents / 100).toFixed(2), duration: String(plan.durationMonths), benefits: Array.isArray(plan.benefits) ? plan.benefits.filter((benefit): benefit is string => typeof benefit === "string").join("\n") : "" });
    planUpdateAttemptRef.current = null;
  }
  async function savePlan(event: FormEvent, plan: Plan) {
    event.preventDefault();
    if (!planDraft || mutationLockRef.current) return;
    mutationLockRef.current = true; setPlanSaving(true); setError(null);
    const payload = { name: planDraft.name.trim(), description: planDraft.description.trim() || null, priceCents: Math.round(Number(planDraft.price) * 100), durationMonths: Number(planDraft.duration), benefits: planDraft.benefits.split("\n").map((benefit) => benefit.trim()).filter(Boolean) };
    const fingerprint = JSON.stringify({ planId: plan.id, ...payload });
    if (planUpdateAttemptRef.current?.fingerprint !== fingerprint) planUpdateAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      await apiFetch(`/management/membership-plans/${plan.id}`, { method: "PATCH", accessToken, headers: { "Idempotency-Key": planUpdateAttemptRef.current.requestId }, body: JSON.stringify(payload) });
      planUpdateAttemptRef.current = null; setEditingPlanId(null); setPlanDraft(null); await loadPlans();
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "Membership plan could not be updated."); }
    finally { mutationLockRef.current = false; setPlanSaving(false); }
  }
  async function exportCsv() {
    const params = new URLSearchParams();
    if (query.trim()) params.set("query", query.trim());
    if (status) params.set("status", status);
    if (lifecycle) params.set("lifecycle", lifecycle);
    setError(null);
    try {
      const blob = await apiDownload(`/management/memberships.csv${params.size ? `?${params}` : ""}`, { accessToken });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "memberships.csv"; anchor.click(); URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "The membership export could not be downloaded."); }
  }
  return <main className="admin-route-page membership-directory-page">
    <header className="admin-page-heading"><div><p className="kicker">CUSTOMER PROGRAMS</p><h1>Memberships</h1><p>Configure cinema membership plans and maintain member records.</p></div><div className="film-library-heading-actions"><button className="secondary" type="button" onClick={() => void exportCsv()}>Export filtered CSV</button><Link href="/search" className="primary">Find a customer</Link></div></header>
    <section className="dashboard-metrics" aria-label="Membership program summary"><article className="dashboard-metric"><span>Active members</span><strong>{summary?.active ?? "—"}</strong><small>{summary?.recentEnrollments ?? "—"} enrolled in the last 30 days</small></article><button type="button" className={`dashboard-metric membership-queue-card${lifecycle === "EXPIRING" ? " active" : ""}`} aria-pressed={lifecycle === "EXPIRING"} onClick={() => { setLifecycle(lifecycle === "EXPIRING" ? "" : "EXPIRING"); setStatus(""); }}><span>Expiring soon</span><strong>{summary?.expiringSoon ?? "—"}</strong><small>View memberships ending within 30 days</small></button><button type="button" className={`dashboard-metric membership-queue-card${lifecycle === "LAPSED" ? " active" : ""}`} aria-pressed={lifecycle === "LAPSED"} onClick={() => { setLifecycle(lifecycle === "LAPSED" ? "" : "LAPSED"); setStatus(""); }}><span>Lapsed</span><strong>{summary?.lapsed ?? "—"}</strong><small>View records requiring renewal outreach</small></button><article className="dashboard-metric"><span>Online membership revenue</span><strong>{summary ? money(summary.collectedAmountCents, summary.currency) : "—"}</strong><small>{summary?.paidEnrollments ?? "—"} completed enrollments and renewals</small></article></section>
    <section className="membership-plan-layout">
      <form className="panel membership-plan-form" onSubmit={createPlan}><div><p className="kicker">PLANS</p><h2>Create a membership plan</h2></div><label>Name<input required maxLength={100} value={planName} onChange={(event) => setPlanName(event.target.value)} placeholder="Supporting Member" /></label><label>Description<textarea maxLength={1000} value={planDescription} onChange={(event) => setPlanDescription(event.target.value)} /></label><div className="membership-plan-fields"><label>Price<input type="number" min="0" max="10000" step="0.01" required value={planPrice} onChange={(event) => setPlanPrice(event.target.value)} /></label><label>Duration (months)<input type="number" min="1" max="120" required value={planDuration} onChange={(event) => setPlanDuration(event.target.value)} /></label></div><label>Benefits, one per line<textarea maxLength={5000} value={planBenefits} onChange={(event) => setPlanBenefits(event.target.value)} placeholder={'Two free tickets\nMember pricing\nInvitations to member events'} /></label><button className="primary" disabled={planSaving}>{planSaving ? "Creating…" : "Create plan"}</button></form>
      <section className="panel membership-plan-list"><div><p className="kicker">CATALOG</p><h2>Available plans</h2></div>{plans.map((plan) => <article key={plan.id}>{editingPlanId === plan.id && planDraft ? <form className="membership-plan-edit-form" onSubmit={(event) => void savePlan(event, plan)}><label>Name<input required maxLength={100} value={planDraft.name} onChange={(event) => setPlanDraft({ ...planDraft, name: event.target.value })} /></label><label>Description<textarea maxLength={1000} value={planDraft.description} onChange={(event) => setPlanDraft({ ...planDraft, description: event.target.value })} /></label><div className="membership-plan-fields"><label>Price<input type="number" min="0" max="10000" step="0.01" required value={planDraft.price} onChange={(event) => setPlanDraft({ ...planDraft, price: event.target.value })} /></label><label>Duration (months)<input type="number" min="1" max="120" required value={planDraft.duration} onChange={(event) => setPlanDraft({ ...planDraft, duration: event.target.value })} /></label></div><label>Benefits, one per line<textarea maxLength={5000} value={planDraft.benefits} onChange={(event) => setPlanDraft({ ...planDraft, benefits: event.target.value })} /></label><div className="membership-plan-actions"><button className="primary" disabled={planSaving}>{planSaving ? "Saving…" : "Save plan"}</button><button className="secondary" type="button" disabled={planSaving} onClick={() => { setEditingPlanId(null); setPlanDraft(null); planUpdateAttemptRef.current = null; }}>Cancel</button></div></form> : <><div><strong>{plan.name}</strong><small>{money(plan.priceCents)} · {plan.durationMonths} months · {plan._count.memberships} members</small>{plan.description && <p>{plan.description}</p>}<ul>{Array.isArray(plan.benefits) && plan.benefits.map((benefit) => typeof benefit === "string" ? <li key={benefit}>{benefit}</li> : null)}</ul></div><div className="membership-plan-actions"><button className="secondary" type="button" disabled={planSaving} onClick={() => beginPlanEdit(plan)}>Edit</button><button className="secondary" type="button" disabled={planSaving} onClick={() => void togglePlan(plan)}>{plan.active ? "Deactivate" : "Reactivate"}</button></div></>}</article>)}{!plans.length && <p className="dashboard-empty">No membership plans have been configured.</p>}</section>
    </section>
    <section className="panel membership-directory-filters"><label>Search<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Member number, tier, name, email, or phone" /></label><label>Status<select value={status} onChange={(event) => { setStatus(event.target.value as Status); setLifecycle(""); }}><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="EXPIRED">Expired</option><option value="SUSPENDED">Suspended</option><option value="CANCELED">Canceled</option></select></label>{lifecycle && <button className="secondary" type="button" onClick={() => setLifecycle("")}>Clear {lifecycle === "EXPIRING" ? "expiring soon" : "lapsed"} queue</button>}</section>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <section className="panel membership-directory"><div className="dashboard-section-heading"><div><p className="kicker">DIRECTORY</p><h2>Member records</h2></div><span>{memberships.length} shown</span></div>
      {loading ? <p className="dashboard-empty">Loading memberships…</p> : <div className="membership-directory-table"><header><span>Member</span><span>Customer</span><span>Tier</span><span>Status</span><span>Expiration</span><span>Updated</span></header>{memberships.map((membership) => <Link href={`/customers/${membership.customer.id}`} key={membership.id}><span><strong>#{membership.membershipNumber}</strong></span><span><strong>{membership.customer.name || "Unnamed customer"}</strong><small>{membership.customer.email || membership.customer.phone || "No contact details"}</small></span><span>{membership.tier}</span><span className="status-chip">{membership.status.toLowerCase()}</span><span>{membership.expiresAt ? date(membership.expiresAt) : "No expiration"}</span><span>{date(membership.updatedAt)}</span></Link>)}</div>}
      {!loading && !memberships.length && <p className="dashboard-empty">No memberships match these filters.</p>}
    </section>
  </main>;
}
