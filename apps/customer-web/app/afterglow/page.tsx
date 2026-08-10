"use client";
import Link from "next/link";
import { useCinemaContent } from "../components/customer-branding";

export default function AfterglowPage() {
  const { afterglow } = useCinemaContent();
  return <main className="cinema-shell route-page afterglow-page">
    <section className="afterglow-hero"><img src={afterglow.imageUrl} alt={afterglow.imageAlt} /><div><span className="eyebrow">{afterglow.eyebrow}</span><h1>{afterglow.title}</h1></div></section>
    <section className="afterglow-copy"><div><span className="eyebrow">{afterglow.sectionEyebrow}</span><h2>{afterglow.sectionTitle}</h2></div><div>{afterglow.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}<Link className="primary-link" href="/dining-bar">{afterglow.buttonLabel}</Link></div></section>
  </main>;
}
