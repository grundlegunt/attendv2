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

type StaffLoginResponse = (AuthTokenResponse & { employee: AuthenticatedEmployee }) | { mfaRequired: true; challengeToken: string };
type ActiveStaffSession = AuthTokenResponse & { employee: AuthenticatedEmployee };
const STORAGE_KEY = "attend-staff-pos-session";

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
  const [view, setView] = useState<"scanner" | "seats" | "tabs" | "restaurant" | "box-office">("scanner");
  const [tabOrderId, setTabOrderId] = useState("");
  const [tabMode, setTabMode] = useState<"SHARED" | "SEPARATE">("SHARED");
  const [openedTabs, setOpenedTabs] = useState<TabSummary[]>([]);
  const [seatDetail, setSeatDetail] = useState<SeatDetail | null>(null);
  const [openingTabs, setOpeningTabs] = useState(false);
  const openingTabsRef = useRef(false);
  const seatDetailRequestRef = useRef(0);
  const availabilityRequestRef = useRef(0);
  const [clockReady, setClockReady] = useState(false);
  const [clockPin, setClockPin] = useState("");
  const [mfaChallengeToken, setMfaChallengeToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [expiresInSeconds, setExpiresInSeconds] = useState(0);
  const [restored, setRestored] = useState(false);
  const authRequestRef = useRef(false);

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

  function storeSession(next: ActiveStaffSession) {
    setEmployee(next.employee); setAccessToken(next.accessToken); setRefreshToken(next.refreshToken); setExpiresInSeconds(next.expiresInSeconds);
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  async function refreshSession(token: string) {
    const next = await apiFetch<ActiveStaffSession>("/auth/staff/refresh", { method: "POST", body: JSON.stringify({ refreshToken: token }) });
    storeSession(next);
  }

  function signOut() {
    if (accessToken) void apiFetch("/auth/staff/logout", { accessToken, method: "POST" }).catch(() => undefined);
    window.sessionStorage.removeItem(STORAGE_KEY);
    setEmployee(null); setAccessToken(""); setRefreshToken(""); setExpiresInSeconds(0); setClockPin(""); setClockReady(false);
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
    if (!selectedShowtimeId) return;
    const requestId = ++availabilityRequestRef.current;
    try {
      const response = await apiFetch<SeatAvailabilityResponse>(`/cinema/showtimes/${selectedShowtimeId}/seats`);
      if (requestId !== availabilityRequestRef.current) return;
      setAvailability(response);
    } catch {
      if (requestId !== availabilityRequestRef.current) return;
      setError("The live seat map is temporarily unavailable.");
    }
  }, [selectedShowtimeId]);

  useEffect(() => {
    if (!employee || employee.mustChangePassword) return;
    apiFetch<NowPlayingResponse>("/cinema/now-playing")
      .then((response) => {
        setProgram(response);
        const firstShowtime = response.movies.flatMap((movie) => movie.showtimes)[0];
        if (firstShowtime) {
          availabilityRequestRef.current += 1;
          setAvailability(null);
          setSelectedShowtimeId(firstShowtime.id);
        }
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
    if (!beginAuthRequest()) return;
    setError(null);
    try {
      const res = await apiFetch<StaffLoginResponse>(
        "/auth/staff/login",
        { method: "POST", body: JSON.stringify({ email, password }) },
      );
      if ("mfaRequired" in res) { setMfaChallengeToken(res.challengeToken); setPassword(""); return; }
      storeSession(res);
      setCurrentPassword(password);
      setPassword("");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Something went wrong. Please try again.");
    } finally {
      finishAuthRequest();
    }
  }

  async function verifyMfa(event: FormEvent) {
    event.preventDefault();
    if (!beginAuthRequest()) return;
    setError(null);
    try {
      const res = await apiFetch<AuthTokenResponse & { employee: AuthenticatedEmployee }>("/auth/staff/mfa/verify", { method: "POST", body: JSON.stringify({ challengeToken: mfaChallengeToken, code: mfaCode }) });
      storeSession(res); setMfaChallengeToken(null); setMfaCode("");
    } catch (err) { setError(err instanceof ApiRequestError ? err.body.message : "The code could not be verified."); }
    finally { finishAuthRequest(); }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault(); setError(null);
    if (newPassword !== confirmPassword) { setError("New passwords do not match."); return; }
    if (!beginAuthRequest()) return;
    try {
      const res = await apiFetch<AuthTokenResponse & { employee: AuthenticatedEmployee }>("/auth/staff/change-password", { accessToken, method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
      storeSession(res); setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    } catch (err) { setError(err instanceof ApiRequestError ? err.body.message : "The password could not be changed."); }
    finally { finishAuthRequest(); }
  }

  async function openTabs(event: FormEvent) {
    event.preventDefault();
    if (openingTabsRef.current) return;
    openingTabsRef.current = true;
    setOpeningTabs(true);
    setError(null);
    try {
      setOpenedTabs(await apiFetch<TabSummary[]>("/restaurant-tabs/seat-linked", {
        method: "POST",
        accessToken,
        body: JSON.stringify({ ticketOrderId: tabOrderId, mode: tabMode }),
      }));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Tabs could not be opened.");
    } finally {
      openingTabsRef.current = false;
      setOpeningTabs(false);
    }
  }

  async function openSeat(seat: SeatMapSeat) {
    if (!seat.id) return;
    const requestId = ++seatDetailRequestRef.current;
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
    }
  }

  if (!restored) return <main className="auth-shell"><div className="auth-card"><p>Restoring staff session…</p></div></main>;

  if (mfaChallengeToken) {
    return <main className="auth-shell"><div className="auth-card"><h1>Authenticator code</h1><p className="subtitle">Enter the current 6-digit code from your authenticator app.</p>{error && <div className="error-banner">{error}</div>}<form onSubmit={verifyMfa}>
      <div className="field"><label htmlFor="mfa-code">Authenticator code</label><input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, ""))} /></div>
      <button className="primary" disabled={loading}>{loading ? "Verifying..." : "Verify and sign in"}</button>
    </form></div></main>;
  }

  if (employee?.mustChangePassword) {
    return <main className="auth-shell"><div className="auth-card"><h1>Choose a new password</h1><p className="subtitle">Replace the temporary password before continuing.</p>{error && <div className="error-banner">{error}</div>}<form onSubmit={changePassword}>
      <div className="field"><label htmlFor="current-password">Temporary password</label><input id="current-password" type="password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></div>
      <div className="field"><label htmlFor="new-password">New password</label><input id="new-password" type="password" minLength={12} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></div>
      <div className="field"><label htmlFor="confirm-password">Confirm new password</label><input id="confirm-password" type="password" minLength={12} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></div>
      <button className="primary" disabled={loading}>{loading ? "Changing password..." : "Change password"}</button>
    </form></div></main>;
  }

  if (employee?.mfaSetupRequired) return <main className="auth-shell"><div className="auth-card"><h1>MFA setup required</h1><p className="subtitle">Sign in to Attend Admin to connect an authenticator app before using staff tools.</p></div></main>;

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

        <nav className="staff-tabs" aria-label="Staff tools">
          <button type="button" className={view === "scanner" ? "active" : ""} onClick={() => setView("scanner")}>Scan tickets</button>
          <button type="button" className={view === "seats" ? "active" : ""} onClick={() => setView("seats")}>Live seats</button>
          <button type="button" className={view === "tabs" ? "active" : ""} onClick={() => setView("tabs")}>Tab debug</button>
          <button type="button" className={view === "restaurant" ? "active" : ""} onClick={() => setView("restaurant")}>Server POS</button>
          {employee.permissions.includes("seat.sell") && <button type="button" className={view === "box-office" ? "active" : ""} onClick={() => setView("box-office")}>Box office</button>}
        </nav>

        {view !== "tabs" && view !== "restaurant" && <section className="showtime-toolbar" aria-label="Select a showtime">
          <label htmlFor="showtime">Showtime</label>
          <select id="showtime" value={selectedShowtimeId} onChange={(event) => {
            availabilityRequestRef.current += 1;
            setAvailability(null);
            setSelectedShowtimeId(event.target.value);
          }}>
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

        {view === "box-office" && availability ? (
          <BoxOfficePos accessToken={accessToken} showtimeId={selectedShowtimeId} seats={availability.seats} refresh={loadAvailability} />
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
                <input required value={tabOrderId} onChange={(event) => setTabOrderId(event.target.value)} />
              </label>
              <label className="field">
                <span>Tab arrangement</span>
                <select value={tabMode} onChange={(event) => setTabMode(event.target.value as "SHARED" | "SEPARATE")}>
                  <option value="SHARED">One shared tab</option>
                  <option value="SEPARATE">One tab per seat</option>
                </select>
              </label>
              <button className="primary" disabled={openingTabs}>
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
