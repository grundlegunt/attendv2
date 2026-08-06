"use client";
import { useCinemaContent } from "../components/customer-branding";

export default function PrivateEventsPage() {
  const { privateEvents } = useCinemaContent();
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
    </main>
  );
}
