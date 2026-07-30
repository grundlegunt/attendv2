"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { AuthenticatedEmployee, AuthTokenResponse, NowPlayingMovie } from "@cinema/shared";
import { SeatMap, type SeatMapSeat } from "@cinema/ui";
import { apiFetch, ApiRequestError } from "./lib/api-client";
import { TicketScanner } from "./ticket-scanner";
import { RestaurantPos } from "./restaurant-pos";

interface NowPlayingResponse {
  location: { id: string; name: string; timezone: string };
  movies: NowPlayingMovie[];
}

interface AvailabilitySeat extends Omit<SeatMapSeat, "state"> {
  id: string;
  state: "AVAILABLE" | "HELD" | "SOLD" | "BLOCKED";
}

interface SeatAvailabilityResponse {
  showtimeId: string;
  seats: AvailabilitySeat[];
  counts: { available: number; held: number; sold: number; blocked: number };
}

interface TabSummary {
  id: string;
  status: string;
  paymentMethod: { brand: string; last4: string } | null;
  seats: Array<{ seat: string }>;
}

interface SeatDetail {
  id: string;
  seat: string;
  tab: TabSummary | null;
}

export default function StaffLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [employee, setEmployee] = useState<AuthenticatedEmployee | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [program, setProgram] = useState<NowPlayingResponse | null>(null);
  const [selectedShowtimeId, setSelectedShowtimeId] = useState<string>("");
  const [availability, setAvailability] = useState<SeatAvailabilityResponse | null>(null);
  const [view, setView] = useState<"scanner" | "seats" | "tabs" | "restaurant">("scanner");
  const [tabOrderId, setTabOrderId] = useState("");
  const [tabMode, setTabMode] = useState<"SHARED" | "SEPARATE">("SHARED");
  const [openedTabs, setOpenedTabs] = useState<TabSummary[]>([]);
  const [seatDetail, setSeatDetail] = useState<SeatDetail | null>(null);

  const loadAvailability = useCallback(async () => {
    if (!selectedShowtimeId) return;
    try {
      setAvailability(await apiFetch<SeatAvailabilityResponse>(`/cinema/showtimes/${selectedShowtimeId}/seats`));
    } catch {
      setError("The live seat map is temporarily unavailable.");
    }
  }, [selectedShowtimeId]);

  useEffect(() => {
    if (!employee) return;
    apiFetch<NowPlayingResponse>("/cinema/now-playing")
      .then((response) => {
        setProgram(response);
        const firstShowtime = response.movies.flatMap((movie) => movie.showtimes)[0];
        if (firstShowtime) setSelectedShowtimeId(firstShowtime.id);
      })
      .catch(() => setError("Showtimes are temporarily unavailable."));
  }, [employee]);

  useEffect(() => {
    if (!selectedShowtimeId) return;
    void loadAvailability();
    const timer = window.setInterval(() => void loadAvailability(), 2_000);
    return () => window.clearInterval(timer);
  }, [loadAvailability, selectedShowtimeId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<AuthTokenResponse & { employee: AuthenticatedEmployee }>(
        "/auth/staff/login",
        { method: "POST", body: JSON.stringify({ email, password }) },
      );
      setEmployee(res.employee);
      setAccessToken(res.accessToken);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function openTabs(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      setOpenedTabs(await apiFetch<TabSummary[]>("/restaurant-tabs/seat-linked", {
        method: "POST",
        accessToken,
        body: JSON.stringify({ ticketOrderId: tabOrderId, mode: tabMode }),
      }));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Tabs could not be opened.");
    }
  }

  async function openSeat(seat: SeatMapSeat) {
    if (!seat.id) return;
    setError(null);
    try {
      const detail = await apiFetch<SeatDetail>(
        `/restaurant-tabs/seats/${seat.id}/detail`,
        { accessToken },
      );
      setSeatDetail(detail);
      setView("restaurant");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Seat detail could not be opened.");
    }
  }

  if (employee) {
    const seatMapSeats = availability?.seats.map((seat) => ({
      ...seat,
      state: seat.state === "AVAILABLE" ? "available" as const : "unavailable" as const,
    })) ?? [];

    return (
      <main className="staff-shell">
        <header className="staff-header">
          <div><span className="eyebrow">ATTEND STAFF</span><h1>Live seats</h1></div>
          <p>{employee.name} · {employee.roles.join(", ")}</p>
        </header>

        {error && <div className="error-banner">{error}</div>}

        <nav className="staff-tabs" aria-label="Staff tools">
          <button type="button" className={view === "scanner" ? "active" : ""} onClick={() => setView("scanner")}>Scan tickets</button>
          <button type="button" className={view === "seats" ? "active" : ""} onClick={() => setView("seats")}>Live seats</button>
          <button type="button" className={view === "tabs" ? "active" : ""} onClick={() => setView("tabs")}>Tab debug</button>
          <button type="button" className={view === "restaurant" ? "active" : ""} onClick={() => setView("restaurant")}>Server POS</button>
        </nav>

        {view !== "tabs" && view !== "restaurant" && <section className="showtime-toolbar" aria-label="Select a showtime">
          <label htmlFor="showtime">Showtime</label>
          <select id="showtime" value={selectedShowtimeId} onChange={(event) => setSelectedShowtimeId(event.target.value)}>
            {program?.movies.flatMap((movie) =>
              movie.showtimes.map((showtime) => (
                <option key={showtime.id} value={showtime.id}>
                  {movie.title} · {new Date(showtime.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {showtime.auditorium.name}
                </option>
              )),
            )}
          </select>
          {availability && (
            <div className="seat-counts" aria-live="polite">
              <strong>{availability.counts.available} available</strong>
              <span>{availability.counts.held} held</span>
              <span>{availability.counts.sold} sold</span>
              <span>{availability.counts.blocked} blocked</span>
            </div>
          )}
        </section>}

        {view === "restaurant" ? (
          <RestaurantPos
            accessToken={accessToken}
            initialTabId={seatDetail?.tab?.id}
            showtimeSeatId={seatDetail?.id}
            seatLabel={seatDetail?.seat}
          />
        ) : view === "tabs" ? (
          <section className="scanner-panel">
            <h2>Open seat-linked tabs</h2>
            <p>Internal Milestone 5 verification view. Enter a paid ticket order ID.</p>
            <form onSubmit={openTabs}>
              <label className="field">
                <span>Ticket order ID</span>
                <input required value={tabOrderId} onChange={(event) => setTabOrderId(event.target.value)} />
              </label>
              <label className="field">
                <span>Tab arrangement</span>
                <select value={tabMode} onChange={(event) => setTabMode(event.target.value as "SHARED" | "SEPARATE")}>
                  <option value="SHARED">One shared tab</option>
                  <option value="SEPARATE">One tab per seat</option>
                </select>
              </label>
              <button className="primary">Open tabs</button>
            </form>
            {openedTabs.map((tab) => (
              <div className="scan-result valid" key={tab.id}>
                <strong>{tab.status}</strong>
                <p>Seats {tab.seats.map((seat) => seat.seat).join(", ")}</p>
                <p>{tab.paymentMethod ? `${tab.paymentMethod.brand} •••• ${tab.paymentMethod.last4}` : "Payment required"}</p>
              </div>
            ))}
          </section>
        ) : view === "scanner" && selectedShowtimeId ? (
          <TicketScanner accessToken={accessToken} expectedShowtimeId={selectedShowtimeId} />
        ) : view === "scanner" ? (
          <p>Select a showtime before scanning tickets.</p>
        ) : (
          <>
            {selectedShowtimeId && !availability && <p>Loading live seats…</p>}
            {availability && (
              <SeatMap
                seats={seatMapSeats}
                label="Live auditorium seat map"
                onSeatClick={openSeat}
                allowUnavailableSelection
              />
            )}
          </>
        )}
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <h1>Staff Sign In</h1>
        <p className="subtitle">Box office &amp; server access</p>

        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="primary" type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
