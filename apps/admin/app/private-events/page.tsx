"use client";
import { useEffect, useState } from "react";
import { useAdminSession } from "../admin-session";
import { apiFetch } from "../lib/api-client";
type Inquiry = { id: string; name: string; email: string; phone: string | null; eventType: string; preferredDate: string | null; guestCount: number | null; message: string; status: string; createdAt: string };
export default function PrivateEventsAdminPage() {
  const { accessToken } = useAdminSession(); const [items, setItems] = useState<Inquiry[]>([]); const [query, setQuery] = useState(""); const [statusFilter, setStatusFilter] = useState("");
  const parameters = new URLSearchParams();
  if (query.trim()) parameters.set("query", query.trim());
  if (statusFilter) parameters.set("status", statusFilter);
  const path = `/management/private-event-inquiries${parameters.size ? `?${parameters}` : ""}`;
  useEffect(() => { const timer = window.setTimeout(() => { void apiFetch<Inquiry[]>(path, { accessToken }).then(setItems); }, 250); return () => window.clearTimeout(timer); }, [accessToken, path]);
  async function status(id: string, next: string) { await apiFetch(`/management/private-event-inquiries/${id}`, { accessToken, method: "PATCH", body: JSON.stringify({ status: next }) }); setItems((current) => current.map((item) => item.id === id ? { ...item, status: next } : item).filter((item) => !statusFilter || item.status === statusFilter)); }
  async function exportCsv() {
    const base = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "https://zealous-connection-production-0896.up.railway.app/api/v1" : "http://localhost:4000/api/v1");
    const response = await fetch(`${base}${path.replace("/management/private-event-inquiries", "/management/private-event-inquiries.csv")}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) return;
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "private-event-inquiries.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return <main className="admin-route-page"><section className="panel"><p className="kicker">PRIVATE EVENTS</p><h2>Inquiry queue</h2><div className="filter-grid"><label>Search<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, email, event, or notes" /></label><label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option><option>NEW</option><option>CONTACTED</option><option>BOOKED</option><option>CLOSED</option></select></label></div><button className="secondary" type="button" onClick={() => void exportCsv()}>Export filtered CSV</button><div className="audit-list">{items.map((item) => <article className="audit-event" key={item.id}><div className="management-heading"><div><strong>{item.name}</strong><small>{item.email}{item.phone ? ` · ${item.phone}` : ""}</small></div><select aria-label={`Status for ${item.name}`} value={item.status} onChange={(event) => void status(item.id, event.target.value)}><option>NEW</option><option>CONTACTED</option><option>BOOKED</option><option>CLOSED</option></select></div><h3>{item.eventType}</h3><p>{item.message}</p><small>{item.preferredDate ? new Date(item.preferredDate).toLocaleDateString() : "No preferred date"}{item.guestCount ? ` · ${item.guestCount} guests` : ""} · received {new Date(item.createdAt).toLocaleString()}</small></article>)}{items.length === 0 && <p>No inquiries match these filters.</p>}</div></section></main>;
}
