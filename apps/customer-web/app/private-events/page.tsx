"use client";
import { FormEvent, useState } from "react";
import { useCinemaContent } from "../components/customer-branding";
import { apiFetch, ApiRequestError } from "../lib/api-client";

export default function PrivateEventsPage() {
  const { privateEvents } = useCinemaContent();
  const [draft, setDraft] = useState({ name: "", email: "", phone: "", eventType: "Private screening", preferredDate: "", guestCount: "", message: "" });
  const [notice, setNotice] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); setNotice(""); try { await apiFetch("/cinema/private-event-inquiries", { method: "POST", body: JSON.stringify({ ...draft, preferredDate: draft.preferredDate ? new Date(`${draft.preferredDate}T12:00:00`).toISOString() : undefined, guestCount: draft.guestCount ? Number(draft.guestCount) : undefined }) }); setNotice("Thanks — our team will follow up about your event."); setDraft({ name: "", email: "", phone: "", eventType: "Private screening", preferredDate: "", guestCount: "", message: "" }); } catch (reason) { setNotice(reason instanceof ApiRequestError ? reason.body.message : "Your inquiry could not be sent."); } }
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
      <form className="private-event-form content-panel" onSubmit={(event) => void submit(event)}><h2>Start planning</h2><label>Name<input required maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label>Email<input required type="email" maxLength={200} value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></label><label>Phone<input maxLength={40} value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></label><label>Event type<select value={draft.eventType} onChange={(event) => setDraft({ ...draft, eventType: event.target.value })}><option>Private screening</option><option>Birthday</option><option>Corporate event</option><option>School or community group</option><option>Other</option></select></label><label>Preferred date<input type="date" value={draft.preferredDate} onChange={(event) => setDraft({ ...draft, preferredDate: event.target.value })} /></label><label>Estimated guests<input type="number" min="1" max="5000" value={draft.guestCount} onChange={(event) => setDraft({ ...draft, guestCount: event.target.value })} /></label><label className="private-event-message">Tell us about your event<textarea required maxLength={2000} value={draft.message} onChange={(event) => setDraft({ ...draft, message: event.target.value })} /></label><button className="primary">Send inquiry</button>{notice && <p className="configuration-note">{notice}</p>}</form>
    </main>
  );
}
