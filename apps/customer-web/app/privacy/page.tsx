export default function PrivacyPage() {
  return (
    <main className="cinema-shell route-page">
      <section className="route-heading">
        <span className="eyebrow">PRIVACY</span>
        <h1>Your choices</h1>
        <p>Ticketing works without optional analytics. You can change your preference at any time using Privacy choices.</p>
      </section>
      <section className="content-panel privacy-notice">
        <h2>Essential data</h2>
        <p>The cinema uses essential storage and processing to provide showtimes, seat holds, checkout, receipts, account access, security, and fraud prevention. These functions cannot be disabled while using the service.</p>
        <h2>Optional analytics</h2>
        <p>Optional analytics is disabled by default. If the cinema enables a privacy-reviewed analytics provider later, events may be collected only after you select Allow optional analytics. Marketing consent remains separate and is never inferred from this choice.</p>
        <h2>What this choice does not include</h2>
        <p>Payment details are handled by the payment provider and are not analytics data. Authentication credentials, ticket credentials, and restaurant payment authorization are never included in optional analytics.</p>
      </section>
    </main>
  );
}
