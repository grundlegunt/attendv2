"use client";
import { useEffect, useRef, useState } from "react";
import { useAdminSession } from "../admin-session";
import { apiDownload, apiFetch, ApiRequestError } from "../lib/api-client";
type Inquiry = { id: string; name: string; email: string; phone: string | null; eventType: string; preferredDate: string | null; guestCount: number | null; message: string; status: string; createdAt: string };
export default function PrivateEventsAdminPage() {
  const { accessToken } = useAdminSession(); const [items, setItems] = useState<Inquiry[]>([]); const [query, setQuery] = useState(""); const [statusFilter, setStatusFilter] = useState(""); const [error, setError] = useState<string | null>(null);
  const statusAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const parameters = new URLSearchParams();
  if (query.trim()) parameters.set("query", query.trim());
  if (statusFilter) parameters.set("status", statusFilter);
  const path = `/management/private-event-inquiries${parameters.size ? `?${parameters}` : ""}`;
  useEffect(() => { const controller = new AbortController(); const timer = window.setTimeout(() => { setError(null); void apiFetch<Inquiry[]>(path, { accessToken, signal: controller.signal }).then(setItems).catch((reason) => { if (reason instanceof Error && reason.name === "AbortError") return; setError(reason instanceof ApiRequestError ? reason.body.message : "Private-event inquiries could not be loaded."); }); }, 250); return () => { window.clearTimeout(timer); controller.abort(); }; }, [accessToken, path]);
  async function status(id: string, next: string) { setError(null); const body = JSON.stringify({ status: next }); const fingerprint = `${id}:${body}`; if (statusAttemptRef.current?.fingerprint !== fingerprint) statusAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() }; try { await apiFetch(`/management/private-event-inquiries/${id}`, { accessToken, method: "PATCH", headers: { "Idempotency-Key": statusAttemptRef.current.requestId }, body }); statusAttemptRef.current = null; setItems((current) => current.map((item) => item.id === id ? { ...item, status: next } : item).filter((item) => !statusFilter || item.status === statusFilter)); } catch (reason) { if (reason instanceof ApiRequestError && reason.status < 500) statusAttemptRef.current = null; setError(reason instanceof ApiRequestError ? reason.body.message : "The inquiry status could not be updated."); } }
  async function exportCsv() {
    setError(null);
    try {
      const blob = await apiDownload(path.replace("/management/private-event-inquiries", "/management/private-event-inquiries.csv"), { accessToken });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "private-event-inquiries.csv";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "The inquiry export could not be downloaded."); }
  }
  return <main className="admin-route-page"><section className="panel"><p className="kicker">PRIVATE EVENTS</p><h2>Inquiry queue</h2>{error && <div className="error-banner" role="alert">{error}</div>}<div className="filter-grid"><label>Search<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, email, event, or notes" /></label><label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option><option>NEW</option><option>CONTACTED</option><option>BOOKED</option><option>CLOSED</option></select></label></div><button className="secondary" type="button" onClick={() => void exportCsv()}>Export filtered CSV</button><div className="audit-list">{items.map((item) => <article className="audit-event" key={item.id}><div className="management-heading"><div><strong>{item.name}</strong><small>{item.email}{item.phone ? ` · ${item.phone}` : ""}</small></div><select aria-label={`Status for ${item.name}`} value={item.status} onChange={(event) => void status(item.id, event.target.value)}><option>NEW</option><option>CONTACTED</option><option>BOOKED</option><option>CLOSED</option></select></div><h3>{item.eventType}</h3><p>{item.message}</p><small>{item.preferredDate ? new Date(item.preferredDate).toLocaleDateString() : "No preferred date"}{item.guestCount ? ` · ${item.guestCount} guests` : ""} · received {new Date(item.createdAt).toLocaleString()}</small></article>)}{items.length === 0 && <p>No inquiries match these filters.</p>}</div></section></main>;
}
