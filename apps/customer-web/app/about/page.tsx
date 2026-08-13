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
    <section className="about-grid"><article className="content-panel"><span className="eyebrow">{about.experienceEyebrow}</span><h2>{about.experienceTitle}</h2>{about.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</article><aside className="content-panel"><span className="eyebrow">{about.contactEyebrow}</span><h2>{location?.name ?? "The cinema"}</h2>{locationError ? <><p className="secondary-copy">{locationError}</p><button className="primary" type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try again</button></> : location?.address ? <><address>{location.address}</address><a className="primary-link" href={directionsUrl!} target="_blank" rel="noreferrer">{about.directionsLabel}</a></> : <p className="secondary-copy">Contact details are being prepared.</p>}</aside></section>
  </main>;
}
