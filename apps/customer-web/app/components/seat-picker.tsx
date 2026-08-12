"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SeatMap, type SeatMapSeat } from "@cinema/ui";
import { apiFetch, ApiRequestError } from "../lib/api-client";
import { TicketCheckout } from "./ticket-checkout";

type AvailabilitySeat = Omit<SeatMapSeat, "state"> & {
  id: string;
  state: "AVAILABLE" | "HELD" | "BLOCKED" | "SOLD";
  heldByMe: boolean;
  holdToken?: string;
  expiresAt?: string;
};

interface Availability {
  showtime: {
    id: string;
    startsAt: string;
    movie: { id: string; title: string };
    auditorium: { id: string; name: string; capacity: number };
    priceTier: {
      ticketPriceMinor: number;
      feeMinor: number;
      currency: string;
    };
  };
  serverTime: string;
  holdDurationSeconds: number;
  seats: AvailabilitySeat[];
}

function getHolderKey() {
  const existing = window.sessionStorage.getItem("attend-seat-holder");
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.sessionStorage.setItem("attend-seat-holder", created);
  return created;
}

export function SeatPicker({
  showtimeId,
  onClose,
}: {
  showtimeId: string;
  onClose: () => void;
}) {
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [holderKey, setHolderKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingSeatIds, setPendingSeatIds] = useState<Record<string, true>>({});
  const [optimisticSeatStates, setOptimisticSeatStates] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(Date.now());
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const refreshRequestRef = useRef(0);
  const refreshPendingRef = useRef(false);
  const pendingSeatIdsRef = useRef(new Set<string>());
  const closingRef = useRef(false);

  useEffect(() => setHolderKey(getHolderKey()), []);

  const refresh = useCallback(async () => {
    if (!holderKey || refreshPendingRef.current) return;
    refreshPendingRef.current = true;
    const requestId = ++refreshRequestRef.current;
    try {
      const nextAvailability = await apiFetch<Availability>(
        `/cinema/showtimes/${showtimeId}/seats?holderKey=${encodeURIComponent(holderKey)}`,
      );
      if (requestId !== refreshRequestRef.current) return;
      setAvailability(nextAvailability);
      setError(null);
    } catch (requestError) {
      if (requestId !== refreshRequestRef.current) return;
      setError(
        requestError instanceof ApiRequestError
          ? requestError.body.message
          : "Seat availability is temporarily unavailable.",
      );
    } finally {
      if (requestId === refreshRequestRef.current) refreshPendingRef.current = false;
    }
  }, [holderKey, showtimeId]);

  useEffect(() => {
    if (checkoutOpen) return;
    void refresh();
    const poller = window.setInterval(() => void refresh(), 2_000);
    return () => {
      refreshRequestRef.current += 1;
      refreshPendingRef.current = false;
      window.clearInterval(poller);
    };
  }, [checkoutOpen, refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const mySeats = useMemo(
    () => availability?.seats.filter((seat) => seat.heldByMe) ?? [],
    [availability],
  );
  const displayedSeats = useMemo(
    () => availability?.seats.filter((seat) => optimisticSeatStates[seat.id] ?? seat.heldByMe) ?? [],
    [availability, optimisticSeatStates],
  );
  const expiresAt = mySeats.reduce(
    (earliest, seat) => Math.min(earliest, seat.expiresAt ? Date.parse(seat.expiresAt) : Infinity),
    Infinity,
  );
  const remainingSeconds = Number.isFinite(expiresAt)
    ? Math.max(0, Math.ceil((expiresAt - now) / 1000))
    : 0;

  async function toggleSeat(seat: AvailabilitySeat) {
    if (!holderKey || pendingSeatIdsRef.current.has(seat.id)) return;
    pendingSeatIdsRef.current.add(seat.id);
    refreshRequestRef.current += 1;
    refreshPendingRef.current = false;
    const selected = !seat.heldByMe;
    setOptimisticSeatStates((states) => ({ ...states, [seat.id]: selected }));
    setPendingSeatIds((seatIds) => ({ ...seatIds, [seat.id]: true }));
    setError(null);
    try {
      if (seat.heldByMe && seat.holdToken) {
        await apiFetch(`/cinema/showtimes/${showtimeId}/holds/${seat.holdToken}`, {
          method: "DELETE",
          body: JSON.stringify({ holderKey }),
        });
      } else {
        await apiFetch(`/cinema/showtimes/${showtimeId}/holds`, {
          method: "POST",
          body: JSON.stringify({ holderKey, seatIds: [seat.id] }),
        });
      }
      await refresh();
    } catch (requestError) {
      setError(
        requestError instanceof ApiRequestError
          ? requestError.body.message
          : "That seat could not be updated.",
      );
      await refresh();
    } finally {
      pendingSeatIdsRef.current.delete(seat.id);
      setOptimisticSeatStates((states) => {
        const next = { ...states };
        delete next[seat.id];
        return next;
      });
      setPendingSeatIds((seatIds) => {
        const next = { ...seatIds };
        delete next[seat.id];
        return next;
      });
    }
  }

  async function closeAndRelease() {
    if (closingRef.current || pendingSeatIdsRef.current.size > 0) return;
    closingRef.current = true;
    setClosing(true);
    try {
      if (holderKey && mySeats.length) {
        await Promise.allSettled(
          mySeats
            .filter((seat) => seat.holdToken)
            .map((seat) =>
              apiFetch(`/cinema/showtimes/${showtimeId}/holds/${seat.holdToken!}`, {
                method: "DELETE",
                body: JSON.stringify({ holderKey }),
              }),
            ),
        );
      }
      onClose();
    } finally {
      closingRef.current = false;
      setClosing(false);
    }
  }

  const mapSeats = availability?.seats.map((seat) => ({
    ...seat,
    state: (optimisticSeatStates[seat.id] ?? seat.heldByMe)
      ? ("selected" as const)
      : seat.state === "AVAILABLE"
        ? ("available" as const)
        : ("unavailable" as const),
  }));

  if (
    checkoutOpen &&
    availability &&
    mySeats.length > 0 &&
    mySeats.every((seat) => seat.holdToken)
  ) {
    return (
      <TicketCheckout
        showtimeId={showtimeId}
        holdTokens={mySeats.map((seat) => seat.holdToken!)}
        holderKey={holderKey}
        seats={mySeats.map((seat) => seat.label)}
        movie={availability.showtime.movie.title}
        auditorium={availability.showtime.auditorium.name}
        onBack={() => setCheckoutOpen(false)}
      />
    );
  }

  return (
    <section className="seat-picker" aria-live="polite">
      <div className="seat-picker__header">
        <button
          className="link"
          disabled={closing || Object.keys(pendingSeatIds).length > 0}
          onClick={() => void closeAndRelease()}
        >
          {closing ? "Releasing seats…" : "← All showtimes"}
        </button>
        <div>
          <span className="eyebrow">SELECT SEATS</span>
          <h2>{availability?.showtime.movie.title ?? "Loading seating chart…"}</h2>
          {availability && (
            <p>
              {availability.showtime.auditorium.name} ·{" "}
              {new Date(availability.showtime.startsAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          )}
        </div>
        {mySeats.length > 0 && (
          <div className="hold-clock">
            <span>Seats held</span>
            <strong>{Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, "0")}</strong>
          </div>
        )}
      </div>
      {error && <div className="error-banner">{error}</div>}
      {!mapSeats && !error && <p className="loading-copy">Loading seat availability…</p>}
      {mapSeats && (
        <SeatMap
          seats={mapSeats}
          label={`${availability?.showtime.movie.title ?? "Showtime"} seating chart`}
          onSeatClick={(seat) => {
            const original = availability?.seats.find((candidate) => candidate.id === seat.id);
            if (original) void toggleSeat(original);
          }}
        />
      )}
      <footer className="seat-picker__summary">
        <div>
          <span className="eyebrow">YOUR SEATS</span>
          <strong>{displayedSeats.length ? displayedSeats.map((seat) => seat.label).join(", ") : "None selected"}</strong>
        </div>
        <button
          className="primary"
          disabled={!mySeats.length || remainingSeconds <= 0 || Object.keys(pendingSeatIds).length > 0}
          onClick={() => setCheckoutOpen(true)}
        >
          Continue to tickets
        </button>
      </footer>
    </section>
  );
}
