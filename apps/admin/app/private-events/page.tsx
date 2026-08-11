"use client";
import { useEffect, useState } from "react";
import { useAdminSession } from "../admin-session";
import { apiFetch } from "../lib/api-client";
type Inquiry = { id: string; name: string; email: string; phone: string | null; eventType: string; preferredDate: string | null; guestCount: number | null; message: string; status: string; createdAt: string };
export default function PrivateEventsAdminPage() {
  const { accessToken } = useAdminSession(); const [items, setItems] = useState<Inquiry[]>([]);
  const load = () => void apiFetch<Inquiry[]>("/management/private-event-inquiries", { accessToken }).then(setItems);
  useEffect(load, [accessToken]);
  async function status(id: string, next: string) { await apiFetch(`/management/private-event-inquiries/${id}`, { accessToken, method: "PATCH", body: JSON.stringify({ status: next }) }); load(); }
  return <main className="admin-route-page"><section className="panel"><p className="kicker">PRIVATE EVENTS</p><h2>Inquiry queue</h2><div className="audit-list">{items.map((item) => <article className="audit-event" key={item.id}><div className="management-heading"><div><strong>{item.name}</strong><small>{item.email}{item.phone ? ` · ${item.phone}` : ""}</small></div><select aria-label={`Status for ${item.name}`} value={item.status} onChange={(event) => void status(item.id, event.target.value)}><option>NEW</option><option>CONTACTED</option><option>BOOKED</option><option>CLOSED</option></select></div><h3>{item.eventType}</h3><p>{item.message}</p><small>{item.preferredDate ? new Date(item.preferredDate).toLocaleDateString() : "No preferred date"}{item.guestCount ? ` · ${item.guestCount} guests` : ""} · received {new Date(item.createdAt).toLocaleString()}</small></article>)}{items.length === 0 && <p>No private-event inquiries yet.</p>}</div></section></main>;
}
