"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AuditoriumSeatingMode, SeatMapLayout } from "@cinema/shared";
import type { SeatMapSeat } from "@cinema/ui";
import { AuditoriumBuilder } from "../auditorium-builder";
import { useAdminSession } from "../admin-session";
import { apiFetch, ApiRequestError } from "../lib/api-client";

interface Auditorium {
  id: string;
  name: string;
  capacity: number;
  seatingMode: AuditoriumSeatingMode;
  seatMap: {
    id: string;
    name: string;
    version: number;
    layoutJson: SeatMapLayout | null;
    seats: Array<SeatMapSeat & {
      rowLabel: string;
      number: number;
      levelKey?: string | null;
      sectionKey?: string | null;
    }>;
  } | null;
}

interface Bootstrap {
  location: { id: string; name: string; auditoriums: Auditorium[] };
}

export default function CinemaSetupPage() {
  const { accessToken, signOut } = useAdminSession();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refreshRequestRef = useRef(0);

  async function refresh() {
    if (!accessToken) return;
    const requestId = ++refreshRequestRef.current;
    try {
      const nextData = await apiFetch<Bootstrap>("/cinema/admin/bootstrap", { accessToken });
      if (requestId === refreshRequestRef.current) setData(nextData);
    } catch (reason) {
      if (requestId === refreshRequestRef.current) showError(reason);
    }
  }

  useEffect(() => {
    void refresh();
    return () => { refreshRequestRef.current += 1; };
  }, [accessToken]);

  function showError(reason: unknown) {
    if (reason instanceof ApiRequestError && reason.status === 401) {
      setError("Your admin session expired. Sign in again, then retry the action.");
      return;
    }
    if (reason instanceof ApiRequestError) {
      const validationErrors = reason.body.details?.errors;
      setError(Array.isArray(validationErrors) && validationErrors.length
        ? `${reason.body.message} ${validationErrors.join(" ")}`
        : reason.body.message);
      return;
    }
    setError("The request could not be completed.");
  }

  return <main>
    <section className="admin-heading">
      <div><p className="kicker">LOCATION CONFIGURATION</p><h1>Auditoriums &amp; Seats</h1><p>Create and maintain auditoriums, capacities, and customer-facing seat maps.</p></div>
    </section>
    {error && <div className="error">{error}{error.startsWith("Your admin session expired") && <button type="button" className="secondary" onClick={signOut}>Sign in again</button>}</div>}
    {notice && <div className="notice">{notice}</div>}
    <section className="cinema-setup-workspace">
      <aside className="setup-location-rail" aria-label="Locations">
        <div className="setup-rail-heading"><p className="kicker">LOCATIONS</p><Link href="/location">Manage</Link></div>
        {data?.location ? <button className="setup-location-card active" type="button">
          <strong>{data.location.name}</strong>
          <span>{data.location.auditoriums.length} {data.location.auditoriums.length === 1 ? "auditorium" : "auditoriums"}</span>
        </button> : <p className="builder-help">Loading your location…</p>}
        <p className="setup-scope-note">Locations shown here follow your staff access. Multi-location staff will be able to switch between every assigned cinema.</p>
      </aside>
      {accessToken && <AuditoriumBuilder
        accessToken={accessToken}
        auditoriums={data?.location.auditoriums ?? []}
        onError={showError}
        onSaved={async (message) => {
          await refresh();
          setError(null);
          setNotice(message);
        }}
      />}
    </section>
  </main>;
}
