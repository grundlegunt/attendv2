"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { AuthenticatedEmployee } from "@cinema/shared";
import { apiFetch, ApiRequestError } from "./lib/api-client";

export function TimeClockGate({ employee, onReady }: { employee: AuthenticatedEmployee; onReady: (pin: string) => void }) {
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const clockRequestRef = useRef(0);
  const clockInAttemptRef = useRef<string | null>(null);

  useEffect(() => {
    clockRequestRef.current += 1;
    busyRef.current = false;
    setBusy(false);
    setPin("");
    setMessage(null);
    clockInAttemptRef.current = null;
    return () => { clockRequestRef.current += 1; };
  }, [employee.id, employee.locationId]);

  function changePin(value: string) {
    clockInAttemptRef.current = null;
    setPin(value.replace(/\D/g, ""));
  }

  async function enter(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    const requestedPin = pin;
    busyRef.current = true;
    const requestId = ++clockRequestRef.current;
    setBusy(true);
    setMessage(null);
    const body = JSON.stringify({ locationId: employee.locationId, employeeId: employee.id, pin: requestedPin });
    try {
      const status = await apiFetch<{ shift: { id: string } | null }>("/shifts/status", { method: "POST", body });
      if (requestId !== clockRequestRef.current) return;
      if (!status.shift) {
        clockInAttemptRef.current ??= crypto.randomUUID();
        await apiFetch("/shifts/clock-in", { method: "POST", body: JSON.stringify({ locationId: employee.locationId, employeeId: employee.id, pin: requestedPin, requestId: clockInAttemptRef.current }) });
      }
      if (requestId !== clockRequestRef.current) return;
      clockInAttemptRef.current = null;
      onReady(requestedPin);
    } catch (error) {
      if (requestId !== clockRequestRef.current) return;
      setMessage(error instanceof ApiRequestError ? error.body.message : "The time clock is unavailable.");
    } finally {
      if (requestId === clockRequestRef.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  return <main className="auth-shell"><div className="auth-card">
    <span className="eyebrow">TIME CLOCK</span><h1>Welcome, {employee.name}</h1>
    <p className="subtitle">Enter your PIN to clock in or resume your active shift.</p>
    {message && <div className="error-banner">{message}</div>}
    <form onSubmit={enter}><div className="field"><label htmlFor="pin">Employee PIN</label>
      <input id="pin" inputMode="numeric" pattern="[0-9]{4,8}" maxLength={8} type="password" autoFocus required value={pin} disabled={busy} onChange={(event) => changePin(event.target.value)} />
    </div><button className="primary" disabled={busy}>{busy ? "Checking…" : "Enter POS"}</button></form>
  </div></main>;
}
