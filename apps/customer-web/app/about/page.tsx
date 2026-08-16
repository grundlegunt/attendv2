"use client";

import { useEffect, useState } from "react";
import type { PublicDiningMenuResponse } from "@cinema/shared";
import { apiFetch, ApiRequestError } from "../lib/api-client";
import { useCinemaContent } from "../components/customer-branding";

export default function AboutPage() {
  const { about } = useCinemaContent();
  const [location, setLocation] = useState<PublicDiningMenuResponse["location"] | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    setLocationError(null);

    void apiFetch<PublicDiningMenuResponse>("/cinema/menu")
      .then((response) => setLocation(response.location))
      .catch((reason) => setLocationError(reason instanceof ApiRequestError ? reason.body.message : "Contact details are unavailable."));
  }, [loadAttempt]);
  const directionsUrl = location?.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.address)}` : null;

  return <main className="cinema-shell route-page about-page">
    <section className="route-heading"><span className="eyebrow">{about.eyebrow}</span><h1>{about.title}</h1><p>{about.intro}</p></section>
    <section className="about-grid"><article className="content-panel"><span className="eyebrow">{about.experienceEyebrow}</span><h2>{about.experienceTitle}</h2>{about.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</article><aside className="content-panel" id="contact"><span className="eyebrow">{about.contactEyebrow}</span><h2>{location?.name ?? "The cinema"}</h2>{locationError ? <><p className="secondary-copy">{locationError}</p><button className="primary" type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try again</button></> : location?.address ? <><address>{location.address}</address><a className="primary-link" href={directionsUrl!} target="_blank" rel="noreferrer">{about.directionsLabel}</a></> : <p className="secondary-copy">Contact details are being prepared.</p>}<p className="secondary-copy">For ticketing, accessibility, group visits, and general questions, contact the cinema team directly.</p></aside></section>
    <section className="about-grid about-details">
      <article className="content-panel" id="press"><span className="eyebrow">PRESS</span><h2>Press inquiries</h2><p>Members of the press can contact the cinema team for interview requests, programming information, and approved media materials.</p></article>
      <article className="content-panel" id="age-policy"><span className="eyebrow">AGE POLICY</span><h2>Welcoming audiences responsibly</h2><p>Age restrictions follow each film&apos;s rating and any additional cinema policy shown during ticket selection. Guests may be asked to present valid photo identification.</p></article>
    </section>
  </main>;
}
