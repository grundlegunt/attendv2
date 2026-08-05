"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiRequestError } from "../lib/api-client";

interface LocationResponse {
  location: { id: string; name: string; address: string | null; timezone: string };
}

export default function DirectionsPage() {
  const [location, setLocation] = useState<LocationResponse["location"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<LocationResponse>("/cinema/now-playing")
      .then((response) => setLocation(response.location))
      .catch((err) => setError(err instanceof ApiRequestError ? err.body.message : "Location details are unavailable."));
  }, []);

  const directionsUrl = location?.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.address)}`
    : null;

  return (
    <main className="cinema-shell route-page">
      <section className="route-heading">
        <span className="eyebrow">PLAN YOUR VISIT</span>
        <h1>Directions</h1>
        <p>Find the cinema and open turn-by-turn directions.</p>
      </section>

      {error && <div className="error-banner">{error}</div>}
      {!location && !error && <p className="loading-copy">Loading location details…</p>}
      {location && (
        <section className="content-panel location-card">
          <span className="eyebrow">LOCATION</span>
          <h2>{location.name}</h2>
          {location.address ? (
            <>
              <address>{location.address}</address>
              <a className="primary-link" href={directionsUrl!} target="_blank" rel="noreferrer">
                Open directions
              </a>
            </>
          ) : (
            <p className="secondary-copy">The cinema has not published an address yet.</p>
          )}
        </section>
      )}
    </main>
  );
}
