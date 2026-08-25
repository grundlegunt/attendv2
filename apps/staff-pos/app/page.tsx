"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { AuthenticatedEmployee, AuthTokenResponse, NowPlayingMovie } from "@cinema/shared";
import { SeatMap, type SeatMapSeat } from "@cinema/ui";
import { apiFetch, ApiRequestError } from "./lib/api-client";
import { TicketScanner } from "./ticket-scanner";
import { RestaurantPos } from "./restaurant-pos";
import { TimeClockGate } from "./time-clock-gate";
import { BoxOfficePos } from "./box-office-pos";
import { ShiftControls } from "./shift-controls";
import { TicketService } from "./ticket-service";
import { formatCinemaTime } from "./cinema-date-time";

type StaffLoginResponse = AuthTokenResponse & { employee: AuthenticatedEmployee };
type ActiveStaffSession = AuthTokenResponse & { employee: AuthenticatedEmployee };
type StaffView = "scanner" | "seats" | "tabs" | "restaurant" | "box-office" | "ticket-service";
const STORAGE_KEY = "attend-staff-pos-session";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isStaffLoginResponse(value: unknown): value is StaffLoginResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<StaffLoginResponse>;
  return typeof response.accessToken === "string"
    && typeof response.refreshToken === "string"
    && typeof response.expiresInSeconds === "number"
    && Boolean(response.employee && typeof response.employee === "object");
}

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
  showtime: {
    auditorium: {
      id: string;
      name: string;
      capacity: number;
      seatingMode: "RESERVED" | "GENERAL_ADMISSION";
      seatingStyle: "SINGLE" | "PAIR" | "LOVESEAT" | "TABLE_2" | "TABLE_4" | "BENCH";
    };
  };
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
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [employee, setEmployee] = useState<AuthenticatedEmployee | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [program, setProgram] = useState<NowPlayingResponse | null>(null);
  const [selectedShowtimeId, setSelectedShowtimeId] = useState<string>("");
  const [availability, setAvailability] = useState<SeatAvailabilityResponse | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [view, setView] = useState<StaffView>("scanner");
  const [tabOrderId, setTabOrderId] = useState("");
  const [tabMode, setTabMode] = useState<"SHARED" | "SEPARATE">("SHARED");
  const [openedTabs, setOpenedTabs] = useState<TabSummary[]>([]);
  const [seatDetail, setSeatDetail] = useState<SeatDetail | null>(null);
  const [seatDetailPending, setSeatDetailPending] = useState(false);
  const [openingTabs, setOpeningTabs] = useState(false);
  const openingTabsRef = useRef(false);
  const openingTabsRequestRef = useRef(0);
  const seatDetailRequestRef = useRef(0);
  const seatDetailPendingRef = useRef(false);
  const availabilityRequestRef = useRef(0);
  const availabilityPendingRef = useRef(false);
  const programRequestRef = useRef(0);
  const refreshRequestRef = useRef(0);
  const [clockReady, setClockReady] = useState(false);
  const [clockPin, setClockPin] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [expiresInSeconds, setExpiresInSeconds] = useState(0);
  const [restored, setRestored] = useState(false);
  const authRequestRef = useRef(false);
  const signOutPendingRef = useRef(false);
  const passwordChangeAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);

  function beginAuthRequest() {
    if (authRequestRef.current) return false;
    authRequestRef.current = true;
    setLoading(true);
    return true;
  }

  function finishAuthRequest() {
    authRequestRef.current = false;
    setLoading(false);
  }

  function changeView(nextView: StaffView) {
    seatDetailRequestRef.current += 1;
    seatDetailPendingRef.current = false;
    setSeatDetailPending(false);
    setSeatDetail(null);
    setError(null);
    setView(nextView);
  }

  function changeTabOrderId(nextOrderId: string) {
    setTabOrderId(nextOrderId);
    setOpenedTabs([]);
    setError(null);
  }

  function changeTabMode(nextMode: "SHARED" | "SEPARATE") {
    setTabMode(nextMode);
    setOpenedTabs([]);
    setError(null);
  }

  function changeShowtime(nextShowtimeId: string) {
    availabilityRequestRef.current += 1;
    availabilityPendingRef.current = false;
    seatDetailRequestRef.current += 1;
    seatDetailPendingRef.current = false;
    setAvailability(null);
    setAvailabilityError(null);
    setError(null);
    setSeatDetail(null);
    setSeatDetailPending(false);
    setSelectedShowtimeId(nextShowtimeId);
  }

  function storeSession(next: ActiveStaffSession) {
    setEmployee(next.employee); setAccessToken(next.accessToken); setRefreshToken(next.refreshToken); setExpiresInSeconds(next.expiresInSeconds);
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  async function refreshSession(token: string) {
    const requestId = ++refreshRequestRef.current;
    const next = await apiFetch<ActiveStaffSession>("/auth/staff/refresh", { method: "POST", body: JSON.stringify({ refreshToken: token }) });
    if (requestId !== refreshRequestRef.current) return;
    storeSession(next);
  }

  function signOut() {
    if (signOutPendingRef.current) return;
    signOutPendingRef.current = true;
    refreshRequestRef.current += 1;
    programRequestRef.current += 1;
    availabilityRequestRef.current += 1;
    availabilityPendingRef.current = false;
    seatDetailRequestRef.current += 1;
    seatDetailPendingRef.current = false;
    openingTabsRequestRef.current += 1;
    openingTabsRef.current = false;
    if (accessToken) {
      void apiFetch("/auth/staff/logout", { accessToken, method: "POST" })
        .catch(() => undefined)
        .finally(() => { signOutPendingRef.current = false; });
    } else {
      signOutPendingRef.current = false;
    }
    window.sessionStorage.removeItem(STORAGE_KEY);
    setEmployee(null); setAccessToken(""); setRefreshToken(""); setExpiresInSeconds(0); setClockPin(""); setClockReady(false);
    setProgram(null); setSelectedShowtimeId(""); setAvailability(null); setAvailabilityError(null); setView("scanner");
    setOpenedTabs([]); setSeatDetail(null); setSeatDetailPending(false); setOpeningTabs(false); setTabOrderId(""); setTabMode("SHARED");
    setPassword(""); setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); setError(null);
  }

  useEffect(() => {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (!stored) { setRestored(true); return; }
    try {
      const parsed = JSON.parse(stored) as Partial<ActiveStaffSession>;
      if (!parsed.refreshToken) throw new Error("Stored session cannot be refreshed.");
      void refreshSession(parsed.refreshToken).catch(() => {
        window.sessionStorage.removeItem(STORAGE_KEY);
        setError("Your staff session expired. Please sign in again.");
      }).finally(() => setRestored(true));
    } catch {
      window.sessionStorage.removeItem(STORAGE_KEY); setRestored(true);
    }
  }, []);

  useEffect(() => {
    if (!refreshToken) return;
    const timer = window.setTimeout(() => void refreshSession(refreshToken).catch(signOut), Math.max(5_000, (expiresInSeconds - 60) * 1_000));
    return () => window.clearTimeout(timer);
  }, [accessToken, expiresInSeconds, refreshToken]);

  const loadAvailability = useCallback(async () => {
    if (!selectedShowtimeId || availabilityPendingRef.current) return;
    availabilityPendingRef.current = true;
    const requestId = ++availabilityRequestRef.current;
    try {
      const response = await apiFetch<SeatAvailabilityResponse>(`/cinema/showtimes/${selectedShowtimeId}/seats`);
      if (requestId !== availabilityRequestRef.current) return;
      setAvailability(response);
      setAvailabilityError(null);
    } catch {
      if (requestId !== availabilityRequestRef.current) return;
      setAvailabilityError("The live seat map is temporarily unavailable. Displayed seat information may be out of date.");
    } finally {
      if (requestId === availabilityRequestRef.current) availabilityPendingRef.current = false;
    }
  }, [selectedShowtimeId]);

  useEffect(() => {
    if (!employee || employee.mustChangePassword) return;
    const requestId = ++programRequestRef.current;
    apiFetch<NowPlayingResponse>("/cinema/now-playing")
      .then((response) => {
        if (requestId !== programRequestRef.current) return;
        setProgram(response);
        const firstShowtime = response.movies.flatMap((movie) => movie.showtimes)[0];
        if (firstShowtime) {
          availabilityRequestRef.current += 1;
          setAvailability(null);
          setAvailabilityError(null);
          setSelectedShowtimeId(firstShowtime.id);
        }
      })
      .catch(() => {
        if (requestId === programRequestRef.current) setError("Showtimes are temporarily unavailable.");
      });
    return () => { programRequestRef.current += 1; };
  }, [employee]);

  useEffect(() => {
    if (!selectedShowtimeId) return;
    void loadAvailability();
    const timer = window.setInterval(() => void loadAvailability(), 2_000);
    return () => window.clearInterval(timer);
  }, [loadAvailability, selectedShowtimeId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!beginAuthRequest()) return;
    const requestId = ++refreshRequestRef.current;
    const requestedEmail = email;
    const requestedPassword = password;
    setError(null);
    try {
      const res = await apiFetch<unknown>(
        "/auth/staff/login",
        { method: "POST", body: JSON.stringify({ email: requestedEmail, password: requestedPassword }) },
      );
      if (requestId !== refreshRequestRef.current) return;
      if (!isStaffLoginResponse(res)) {
        setError("Staff sign-in is still updating. Refresh and try again.");
        return;
      }
      storeSession(res);
      setCurrentPassword(requestedPassword);
      setPassword("");
    } catch (err) {
      if (requestId === refreshRequestRef.current) setError(err instanceof ApiRequestError ? err.body.message : "Something went wrong. Please try again.");
    } finally {
      finishAuthRequest();
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault(); setError(null);
    if (newPassword.length > 200) { setError("New passwords cannot exceed 200 characters."); return; }
    if (newPassword !== confirmPassword) { setError("New passwords do not match."); return; }
    if (!beginAuthRequest()) return;
    const requestId = ++refreshRequestRef.current;
    const requestedCurrentPassword = currentPassword;
    const requestedNewPassword = newPassword;
    const body = JSON.stringify({ currentPassword: requestedCurrentPassword, newPassword: requestedNewPassword });
    if (passwordChangeAttemptRef.current?.fingerprint !== body) passwordChangeAttemptRef.current = { fingerprint: body, requestId: crypto.randomUUID() };
    try {
      const res = await apiFetch<AuthTokenResponse & { employee: AuthenticatedEmployee }>("/auth/staff/change-password", { accessToken, method: "POST", headers: { "Idempotency-Key": passwordChangeAttemptRef.current.requestId }, body });
      if (requestId !== refreshRequestRef.current) return;
      passwordChangeAttemptRef.current = null;
      storeSession(res); setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    } catch (err) { if (requestId === refreshRequestRef.current) setError(err instanceof ApiRequestError ? err.body.message : "The password could not be changed."); }
    finally { finishAuthRequest(); }
  }

  async function openTabs(event: FormEvent) {
    event.preventDefault();
    const requestedOrderId = tabOrderId.trim();
    const requestedTabMode = tabMode;
    if (!UUID_PATTERN.test(requestedOrderId)) {
      setError("Enter a valid ticket order ID.");
      return;
    }
    if (openingTabsRef.current) return;
    openingTabsRef.current = true;
    const requestId = ++openingTabsRequestRef.current;
    setOpeningTabs(true);
    setError(null);
    try {
      const tabs = await apiFetch<TabSummary[]>("/restaurant-tabs/seat-linked", {
        method: "POST",
        accessToken,
        body: JSON.stringify({ ticketOrderId: requestedOrderId, mode: requestedTabMode }),
      });
      if (requestId !== openingTabsRequestRef.current) return;
      setOpenedTabs(tabs);
    } catch (err) {
      if (requestId !== openingTabsRequestRef.current) return;
      setError(err instanceof ApiRequestError ? err.body.message : "Tabs could not be opened.");
    } finally {
      if (requestId === openingTabsRequestRef.current) {
        openingTabsRef.current = false;
        setOpeningTabs(false);
      }
    }
  }

  async function openSeat(seat: SeatMapSeat) {
    if (!seat.id || seatDetailPendingRef.current) return;
    seatDetailPendingRef.current = true;
    const requestId = ++seatDetailRequestRef.current;
    setSeatDetailPending(true);
    setError(null);
    try {
      const detail = await apiFetch<SeatDetail>(
        `/restaurant-tabs/seats/${seat.id}/detail`,
        { accessToken },
      );
      if (requestId !== seatDetailRequestRef.current) return;
      setSeatDetail(detail);
      setView("restaurant");
    } catch (err) {
      if (requestId !== seatDetailRequestRef.current) return;
      setError(err instanceof ApiRequestError ? err.body.message : "Seat detail could not be opened.");
    } finally {
      if (requestId === seatDetailRequestRef.current) {
        seatDetailPendingRef.current = false;
        setSeatDetailPending(false);
      }
    }
  }

  if (!restored) return <main className="auth-shell"><div className="auth-card"><p>Restoring staff session…</p></div></main>;

  if (employee?.mustChangePassword) {
    return <main className="auth-shell"><div className="auth-card"><h1>Choose a new password</h1><p className="subtitle">Replace the temporary password before continuing.</p>{error && <div className="error-banner">{error}</div>}<form onSubmit={changePassword}>
      <div className="field"><label htmlFor="current-password">Temporary password</label><input id="current-password" type="password" required value={currentPassword} disabled={loading} onChange={(event) => setCurrentPassword(event.target.value)} /></div>
      <div className="field"><label htmlFor="new-password">New password</label><input id="new-password" type="password" minLength={12} maxLength={200} required value={newPassword} disabled={loading} onChange={(event) => setNewPassword(event.target.value)} /></div>
      <div className="field"><label htmlFor="confirm-password">Confirm new password</label><input id="confirm-password" type="password" minLength={12} maxLength={200} required value={confirmPassword} disabled={loading} onChange={(event) => setConfirmPassword(event.target.value)} /></div>
      <button className="primary" disabled={loading}>{loading ? "Changing password..." : "Change password"}</button>
    </form></div></main>;
  }

  if (employee?.timeClockEnabled && !clockReady) {
    return <TimeClockGate employee={employee} onReady={(pin) => { setClockPin(pin); setClockReady(true); }} />;
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
          <div><p>{employee.name} · {employee.roles.join(", ")}</p>{employee.timeClockEnabled && <ShiftControls employee={employee} pin={clockPin} onClockOut={() => { setClockPin(""); setClockReady(false); }} />}<button type="button" className="secondary" onClick={signOut}>Sign out</button></div>
        </header>

        {error && <div className="error-banner">{error}</div>}
        {availabilityError && <div className="error-banner">{availabilityError}</div>}

        <nav className="staff-tabs" aria-label="Staff tools">
          <button type="button" className={view === "scanner" ? "active" : ""} onClick={() => changeView("scanner")}>Scan tickets</button>
          <button type="button" className={view === "seats" ? "active" : ""} onClick={() => changeView("seats")}>Live seats</button>
          <button type="button" className={view === "tabs" ? "active" : ""} onClick={() => changeView("tabs")}>Tab debug</button>
          <button type="button" className={view === "restaurant" ? "active" : ""} onClick={() => changeView("restaurant")}>Server POS</button>
          {employee.permissions.includes("seat.sell") && <button type="button" className={view === "box-office" ? "active" : ""} onClick={() => changeView("box-office")}>Box office</button>}
          {employee.permissions.includes("seat.sell") && <button type="button" className={view === "ticket-service" ? "active" : ""} onClick={() => changeView("ticket-service")}>Ticket service</button>}
        </nav>

        {view !== "tabs" && view !== "restaurant" && view !== "ticket-service" && <section className="showtime-toolbar" aria-label="Select a showtime">
          <label htmlFor="showtime">Showtime</label>
          <select id="showtime" value={selectedShowtimeId} onChange={(event) => changeShowtime(event.target.value)}>
            {program?.movies.flatMap((movie) =>
              movie.showtimes.map((showtime) => (
                <option key={showtime.id} value={showtime.id}>
                  {movie.title} · {formatCinemaTime(showtime.startsAt, employee.timezone)} · {showtime.auditorium.name}
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

        {view === "box-office" && availability ? (
          <BoxOfficePos accessToken={accessToken} showtimeId={selectedShowtimeId} seats={availability.seats} seatingMode={availability.showtime.auditorium.seatingMode} seatingStyle={availability.showtime.auditorium.seatingStyle} refresh={loadAvailability} />
        ) : view === "ticket-service" ? (
          <TicketService
            accessToken={accessToken}
            movies={program?.movies ?? []}
            canExchange={employee.permissions.includes("ticket.refund")}
            timeZone={employee.timezone}
          />
        ) : view === "restaurant" ? (
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
                <input required maxLength={36} value={tabOrderId} disabled={openingTabs} onChange={(event) => changeTabOrderId(event.target.value)} />
              </label>
              <label className="field">
                <span>Tab arrangement</span>
                <select value={tabMode} disabled={openingTabs} onChange={(event) => changeTabMode(event.target.value as "SHARED" | "SEPARATE")}>
                  <option value="SHARED">One shared tab</option>
                  <option value="SEPARATE">One tab per seat</option>
                </select>
              </label>
              <button className="primary" disabled={openingTabs || !UUID_PATTERN.test(tabOrderId.trim())}>
                {openingTabs ? "Opening tabs…" : "Open tabs"}
              </button>
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
            {seatDetailPending && <p>Opening seat details…</p>}
            {availability?.showtime.auditorium.seatingMode === "GENERAL_ADMISSION" ? (
              <section className="ga-inventory-panel" aria-label="General admission inventory">
                <span className="eyebrow">GENERAL ADMISSION</span>
                <h2>{availability.showtime.auditorium.name}</h2>
                <p>Capacity {availability.showtime.auditorium.capacity}</p>
                <dl>
                  <div><dt>Available</dt><dd>{availability.counts.available}</dd></div>
                  <div><dt>Held</dt><dd>{availability.counts.held}</dd></div>
                  <div><dt>Sold</dt><dd>{availability.counts.sold}</dd></div>
                  <div><dt>Blocked</dt><dd>{availability.counts.blocked}</dd></div>
                </dl>
              </section>
            ) : availability && (
              <SeatMap
                seats={seatMapSeats}
                seatingStyle={availability.showtime.auditorium.seatingStyle}
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
            <input id="email" type="email" required value={email} disabled={loading} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              required
              value={password}
              disabled={loading}
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
