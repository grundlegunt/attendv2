"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AuditoriumSeatingMode, SeatMapLayout } from "@cinema/shared";
import { SeatMap, type SeatMapSeat } from "@cinema/ui";
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
  const [selectedAuditoriumId, setSelectedAuditoriumId] = useState<string | null>(null);

  async function refresh() {
    if (!accessToken) return;
    setData(await apiFetch<Bootstrap>("/cinema/admin/bootstrap", { accessToken }));
  }

  useEffect(() => { refresh().catch(showError); }, [accessToken]);

  useEffect(() => {
    const auditoriums = data?.location.auditoriums ?? [];
    if (!auditoriums.length) {
      setSelectedAuditoriumId(null);
      return;
    }
    if (!auditoriums.some((room) => room.id === selectedAuditoriumId)) {
      setSelectedAuditoriumId(auditoriums[0]!.id);
    }
  }, [data, selectedAuditoriumId]);

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

  const auditoriums = data?.location.auditoriums ?? [];
  const selectedAuditorium = auditoriums.find((room) => room.id === selectedAuditoriumId) ?? auditoriums[0];
  const reservedSeats = selectedAuditorium?.seatMap?.seats ?? [];
  const accessibleCount = reservedSeats.filter((seat) => seat.type === "ADA").length;
  const companionCount = reservedSeats.filter((seat) => seat.type === "COMPANION").length;

  return <main>
    <section className="admin-heading">
      <div><p className="kicker">CINEMA INVENTORY</p><h1>Auditoriums &amp; Seats</h1><p>Review the current auditorium capacity and customer-facing seat maps.</p></div>
    </section>
    {error && <div className="error">{error}{error.startsWith("Your admin session expired") && <button type="button" className="secondary" onClick={signOut}>Sign in again</button>}</div>}
    <section className="cinema-setup-workspace">
      <aside className="setup-location-rail" aria-label="Locations">
        <div className="setup-rail-heading"><p className="kicker">LOCATIONS</p><Link href="/location">Manage</Link></div>
        {data?.location ? <button className="setup-location-card active" type="button">
          <strong>{data.location.name}</strong>
          <span>{data.location.auditoriums.length} {data.location.auditoriums.length === 1 ? "auditorium" : "auditoriums"}</span>
        </button> : <p className="builder-help">Loading your location…</p>}
        <p className="setup-scope-note">Locations shown here follow your staff access. Multi-location staff will be able to switch between every assigned cinema.</p>
      </aside>
      <section className="auditorium-overview" aria-label="Auditorium inventory">
        <div className="master-managed-note">
          <div><p className="kicker">MANAGED IN ATTEND MASTER</p><h2>Theater structure is read-only here</h2></div>
          <p>Company administrators create, edit, deactivate, and delete auditoriums in Attend Master. Cinema Admin keeps a reliable view of the configuration used for scheduling and ticket sales.</p>
        </div>
        {auditoriums.length ? <>
          <div className="auditorium-options" aria-label="Choose an auditorium">
            {auditoriums.map((room) => <button
              key={room.id}
              type="button"
              className={room.id === selectedAuditorium?.id ? "active" : ""}
              onClick={() => setSelectedAuditoriumId(room.id)}
            >
              <strong>{room.name}</strong>
              <span>{room.capacity} {room.seatingMode === "GENERAL_ADMISSION" ? "GA tickets" : "reserved seats"}</span>
            </button>)}
          </div>
          {selectedAuditorium && <article className="auditorium-readonly-detail">
            <header>
              <div><p className="kicker">{selectedAuditorium.seatingMode === "GENERAL_ADMISSION" ? "GENERAL ADMISSION" : "RESERVED SEATING"}</p><h2>{selectedAuditorium.name}</h2></div>
              <strong>{selectedAuditorium.capacity}<small>{selectedAuditorium.seatingMode === "GENERAL_ADMISSION" ? "ticket capacity" : "configured seats"}</small></strong>
            </header>
            {selectedAuditorium.seatingMode === "GENERAL_ADMISSION" ? <div className="ga-capacity-preview">
              <strong>{selectedAuditorium.capacity}</strong>
              <span>tickets may be sold for each showtime in this auditorium. Customers will not select individual seats.</span>
            </div> : selectedAuditorium.seatMap && reservedSeats.length ? <>
              <div className="auditorium-readonly-stats">
                <span><b>{selectedAuditorium.seatMap.name}</b>seat map</span>
                <span><b>v{selectedAuditorium.seatMap.version}</b>layout version</span>
                <span><b>{accessibleCount}</b>accessible</span>
                <span><b>{companionCount}</b>companion</span>
              </div>
              <SeatMap seats={reservedSeats} label={`${selectedAuditorium.name} read-only seat map`} />
            </> : <div className="empty-state"><h3>No seat map is assigned</h3><p>A company administrator can finish this auditorium in Attend Master.</p></div>}
          </article>}
        </> : data ? <div className="empty-state"><h2>No auditoriums configured</h2><p>Create the cinema&apos;s first auditorium in Attend Master.</p></div> : <p className="builder-help">Loading auditorium inventory…</p>}
      </section>
    </section>
  </main>;
}
