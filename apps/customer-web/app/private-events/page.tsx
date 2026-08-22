"use client";
import { FormEvent, useRef, useState } from "react";
import { useCinemaContent } from "../components/customer-branding";
import { apiFetch, ApiRequestError } from "../lib/api-client";

export default function PrivateEventsPage() {
  const { privateEvents } = useCinemaContent();
  const [draft, setDraft] = useState({ name: "", email: "", phone: "", eventType: "Private screening", preferredDate: "", guestCount: "", message: "" });
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const inquiryAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  async function submit(event: FormEvent) { event.preventDefault(); if (pendingRef.current) return; pendingRef.current = true; setNotice(""); const payload = { ...draft, preferredDate: draft.preferredDate ? new Date(`${draft.preferredDate}T12:00:00`).toISOString() : undefined, guestCount: draft.guestCount ? Number(draft.guestCount) : undefined }; const fingerprint = JSON.stringify(payload); if (inquiryAttemptRef.current?.fingerprint !== fingerprint) inquiryAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() }; setPending(true); try { await apiFetch("/cinema/private-event-inquiries", { method: "POST", headers: { "Idempotency-Key": inquiryAttemptRef.current.requestId }, body: fingerprint }); inquiryAttemptRef.current = null; setNotice("Thanks — our team will follow up about your event."); setDraft({ name: "", email: "", phone: "", eventType: "Private screening", preferredDate: "", guestCount: "", message: "" }); } catch (reason) { if (reason instanceof ApiRequestError && reason.status < 500) inquiryAttemptRef.current = null; setNotice(reason instanceof ApiRequestError ? reason.body.message : "Your inquiry could not be sent."); } finally { pendingRef.current = false; setPending(false); } }
  return (
    <main className="cinema-shell route-page">
      <section className="route-heading">
        <span className="eyebrow">{privateEvents.eyebrow}</span><h1>{privateEvents.title}</h1><p>{privateEvents.intro}</p>
      </section>

      <section className="event-grid" aria-label="Private event options">
        {privateEvents.options.map((option, index) => <article className="content-panel" key={option.title}><span className="event-number">{String(index + 1).padStart(2, "0")}</span><h2>{option.title}</h2><p>{option.body}</p></article>)}
      </section>

      <section className="event-note">
        <h2>{privateEvents.closingTitle}</h2><p>{privateEvents.closingBody}</p>
      </section>
      <form className="private-event-form content-panel" onSubmit={(event) => void submit(event)}><h2>Start planning</h2><label>Name<input required maxLength={120} value={draft.name} disabled={pending} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label>Email<input required type="email" maxLength={200} value={draft.email} disabled={pending} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></label><label>Phone<input maxLength={40} value={draft.phone} disabled={pending} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></label><label>Event type<select value={draft.eventType} disabled={pending} onChange={(event) => setDraft({ ...draft, eventType: event.target.value })}><option>Private screening</option><option>Birthday</option><option>Corporate event</option><option>School or community group</option><option>Other</option></select></label><label>Preferred date<input type="date" value={draft.preferredDate} disabled={pending} onChange={(event) => setDraft({ ...draft, preferredDate: event.target.value })} /></label><label>Estimated guests<input type="number" min="1" max="5000" value={draft.guestCount} disabled={pending} onChange={(event) => setDraft({ ...draft, guestCount: event.target.value })} /></label><label className="private-event-message">Tell us about your event<textarea required maxLength={2000} value={draft.message} disabled={pending} onChange={(event) => setDraft({ ...draft, message: event.target.value })} /></label><button className="primary" disabled={pending}>{pending ? "Sending…" : "Send inquiry"}</button>{notice && <p className="configuration-note">{notice}</p>}</form>
    </main>
  );
}
