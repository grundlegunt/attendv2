"use client";

import { FormEvent, useRef, useState } from "react";
import type { AuthenticatedEmployee } from "@cinema/shared";
import { apiFetch, ApiRequestError } from "./lib/api-client";

export function TimeClockGate({ employee, onReady }: { employee: AuthenticatedEmployee; onReady: (pin: string) => void }) {
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  async function enter(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    const body = JSON.stringify({ locationId: employee.locationId, employeeId: employee.id, pin });
    try {
      const status = await apiFetch<{ shift: { id: string } | null }>("/shifts/status", { method: "POST", body });
      if (!status.shift) await apiFetch("/shifts/clock-in", { method: "POST", body });
      onReady(pin);
    } catch (error) {
      setMessage(error instanceof ApiRequestError ? error.body.message : "The time clock is unavailable.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return <main className="auth-shell"><div className="auth-card">
    <span className="eyebrow">TIME CLOCK</span><h1>Welcome, {employee.name}</h1>
    <p className="subtitle">Enter your PIN to clock in or resume your active shift.</p>
    {message && <div className="error-banner">{message}</div>}
    <form onSubmit={enter}><div className="field"><label htmlFor="pin">Employee PIN</label>
      <input id="pin" inputMode="numeric" pattern="[0-9]{4,8}" type="password" autoFocus required value={pin} onChange={(event) => setPin(event.target.value)} />
    </div><button className="primary" disabled={busy}>{busy ? "Checking…" : "Enter POS"}</button></form>
  </div></main>;
}
