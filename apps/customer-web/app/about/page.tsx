"use client";

import Link from "next/link";
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
    const controller = new AbortController();
    setLocationError(null);

    void apiFetch<PublicDiningMenuResponse>("/cinema/menu", { signal: controller.signal })
      .then((response) => setLocation(response.location))
      .catch((reason) => { if (!controller.signal.aborted) setLocationError(reason instanceof ApiRequestError ? reason.body.message : "Contact details are unavailable."); });
    return () => controller.abort();
  }, [loadAttempt]);
  const directionsUrl = location?.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.address)}` : null;

  return (
    <main className="cinema-shell route-page about-page">
      <section className="route-heading">
        <span className="eyebrow">{about.eyebrow}</span>
        <h1>{about.title}</h1>
        <p>{about.intro}</p>
      </section>

      <section className="about-grid">
        <article className="content-panel">
          <span className="eyebrow">{about.experienceEyebrow}</span>
          <h2>{about.experienceTitle}</h2>
          {about.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </article>
        <article className="content-panel" id="directions">
          <span className="eyebrow">DIRECTIONS</span>
          <h2>Find the cinema</h2>
          {locationError ? (
            <>
              <p className="secondary-copy">{locationError}</p>
              <button className="primary" type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try again</button>
            </>
          ) : location?.address ? (
            <>
              <address>{location.address}</address>
              <a className="primary-link" href={directionsUrl!} target="_blank" rel="noreferrer">{about.directionsLabel}</a>
            </>
          ) : <p className="secondary-copy">Directions are being prepared.</p>}
        </article>
      </section>

      <section className="about-grid about-details" aria-label="Cinema information">
        <article className="content-panel" id="gift-cards">
          <span className="eyebrow">GIFT CARDS</span>
          <h2>Give a night at the movies</h2>
          <p>Purchase a digital gift card for someone special, or check the balance of an existing card.</p>
          <Link className="primary-link" href="/gift-cards">Purchase or check a gift card</Link>
        </article>
        <article className="content-panel" id="support">
          <span className="eyebrow">SUPPORT</span>
          <h2>Support independent cinema</h2>
          <p>Make a secure contribution to general operations or a current fundraising campaign.</p>
          <Link className="primary-link" href="/donate">Make a contribution</Link>
        </article>
        <article className="content-panel" id="membership">
          <span className="eyebrow">MEMBERSHIP</span>
          <h2>Join the cinema</h2>
          <p>Choose a membership plan, support the cinema, and receive member benefits throughout the year.</p>
          <Link className="primary-link" href="/membership">View membership plans</Link>
        </article>
        <article className="content-panel" id="private-events">
          <span className="eyebrow">PRIVATE EVENTS</span>
          <h2>Make the cinema yours</h2>
          <p>Host a private screening, birthday, corporate gathering, or community event with help from the cinema team.</p>
          <Link className="primary-link" href="/private-events">Plan a private event</Link>
        </article>
        <article className="content-panel" id="press">
          <span className="eyebrow">PRESS</span>
          <h2>Press inquiries</h2>
          <p>Members of the press can contact the cinema team for interview requests, programming information, and approved media materials.</p>
        </article>
        <article className="content-panel" id="contact">
          <span className="eyebrow">{about.contactEyebrow}</span>
          <h2>Contact {location?.name ?? "the cinema"}</h2>
          <p>For ticketing, accessibility, group visits, press, and general questions, contact the cinema team directly.</p>
        </article>
        <article className="content-panel" id="age-policy">
          <span className="eyebrow">AGE POLICY</span>
          <h2>Welcoming audiences responsibly</h2>
          <p>Age restrictions follow each film&apos;s rating and any additional cinema policy shown during ticket selection. Guests may be asked to present valid photo identification.</p>
        </article>
      </section>
    </main>
  );
}
