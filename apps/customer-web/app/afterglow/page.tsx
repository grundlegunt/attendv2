import Link from "next/link";

export default function AfterglowPage() {
  return <main className="cinema-shell route-page afterglow-page">
    <section className="afterglow-hero"><img src="/afterglow-bar.png" alt="Guests gathered at the warmly lit Afterglow bar" /><div><span className="eyebrow">BEFORE. AFTER. BETWEEN.</span><h1>Afterglow</h1></div></section>
    <section className="afterglow-copy"><div><span className="eyebrow">BEYOND THE SCREEN</span><h2>Keep the night going</h2></div><div><p>Afterglow is our place to meet for a drink, talk about the movie, or spend an evening even when you are not seeing a show.</p><p>Hours, seating, and service may vary. Check with the cinema team when you arrive.</p><Link className="primary-link" href="/dining-bar">Explore Dining &amp; Bar</Link></div></section>
  </main>;
}
