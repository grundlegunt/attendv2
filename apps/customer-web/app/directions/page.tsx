"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiRequestError } from "../lib/api-client";
import { useCinemaContent } from "../components/customer-branding";

interface LocationResponse {
  location: {
    id: string;
    name: string;
    address: string | null;
    timezone: string;
  };
}

export default function DirectionsPage() {
  const { directions: copy } = useCinemaContent();
  const [location, setLocation] = useState<LocationResponse["location"] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<LocationResponse>("/cinema/now-playing")
      .then((response) => setLocation(response.location))
      .catch((err) =>
        setError(
          err instanceof ApiRequestError
            ? err.body.message
            : "Location details are unavailable.",
        ),
      );
  }, []);

  const directionsUrl = location?.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.address)}`
    : null;

  return (
    <main className="cinema-shell route-page">
      <section className="route-heading">
        <span className="eyebrow">{copy.eyebrow}</span>
        <h1>{copy.title}</h1>
        <p>{copy.intro}</p>
      </section>

      {error && <div className="error-banner">{error}</div>}
      {!location && !error && <p className="loading-copy">{copy.loading}</p>}
      {location && (
        <section className="content-panel location-card">
          <span className="eyebrow">{copy.locationEyebrow}</span>
          <h2>{location.name}</h2>
          {location.address ? (
            <>
              <address>{location.address}</address>
              <a
                className="primary-link"
                href={directionsUrl!}
                target="_blank"
                rel="noreferrer"
              >
                {copy.directionsLabel}
              </a>
            </>
          ) : (
            <p className="secondary-copy">{copy.addressMissing}</p>
          )}
        </section>
      )}
    </main>
  );
}
