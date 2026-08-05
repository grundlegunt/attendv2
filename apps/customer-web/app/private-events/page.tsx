export default function PrivateEventsPage() {
  return (
    <main className="cinema-shell route-page">
      <section className="route-heading">
        <span className="eyebrow">MAKE THE CINEMA YOURS</span>
        <h1>Private Events</h1>
        <p>Host a private screening or bring your group together at the movies.</p>
      </section>

      <section className="event-grid" aria-label="Private event options">
        <article className="content-panel">
          <span className="event-number">01</span>
          <h2>Private screenings</h2>
          <p>Reserve an auditorium for invited guests and a film selected with the cinema team.</p>
        </article>
        <article className="content-panel">
          <span className="event-number">02</span>
          <h2>Celebrations</h2>
          <p>Plan birthdays, anniversaries, reunions, and other group occasions in a cinematic setting.</p>
        </article>
        <article className="content-panel">
          <span className="event-number">03</span>
          <h2>Organizations</h2>
          <p>Gather employees, students, members, or community groups for a shared screening.</p>
        </article>
      </section>

      <section className="event-note">
        <h2>Start with the cinema team</h2>
        <p>
          Contact the cinema directly to discuss dates, film availability, capacity, food and beverage,
          accessibility needs, and pricing. An inquiry does not reserve an auditorium.
        </p>
      </section>
    </main>
  );
}
