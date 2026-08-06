"use client";

import { useEffect, useState } from "react";
import type { PublicDiningMenuResponse } from "@cinema/shared";
import { apiFetch, ApiRequestError } from "../lib/api-client";

export default function AboutPage() {
  const [location, setLocation] = useState<PublicDiningMenuResponse["location"] | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  useEffect(() => {
    void apiFetch<PublicDiningMenuResponse>("/cinema/menu")
      .then((response) => setLocation(response.location))
      .catch((reason) => setLocationError(reason instanceof ApiRequestError ? reason.body.message : "Contact details are unavailable."));
  }, []);
  const directionsUrl = location?.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.address)}` : null;

  return <main className="cinema-shell route-page about-page">
    <section className="route-heading"><span className="eyebrow">OUR CINEMA</span><h1>About</h1><p>Independent cinema, thoughtful programming, and hospitality under one roof.</p></section>
    <section className="about-grid"><article className="content-panel"><span className="eyebrow">THE EXPERIENCE</span><h2>Movies are better together</h2><p>We bring films to the big screen and give audiences a welcoming place to gather around them. Our cinema pairs reserved seating and distinctive programming with food and drink served for the occasion.</p><p>The goal is simple: make every visit feel like a night worth remembering.</p></article><aside className="content-panel"><span className="eyebrow">CONTACT &amp; VISIT</span><h2>{location?.name ?? "The cinema"}</h2>{locationError ? <p className="secondary-copy">{locationError}</p> : location?.address ? <><address>{location.address}</address><a className="primary-link" href={directionsUrl!} target="_blank" rel="noreferrer">Get directions</a></> : <p className="secondary-copy">Contact details are being prepared.</p>}</aside></section>
  </main>;
}
