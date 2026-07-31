"use client";

import { useEffect, useState } from "react";
import type { AuthenticatedEmployee } from "@cinema/shared";
import { apiFetch, ApiRequestError } from "./lib/api-client";

type Shift = { id: string; breakStartAt: string | null; breakEndAt: string | null };

export function ShiftControls({ employee, pin, onClockOut }: { employee: AuthenticatedEmployee; pin: string; onClockOut: () => void }) {
  const [shift, setShift] = useState<Shift | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const body = JSON.stringify({ locationId: employee.locationId, employeeId: employee.id, pin });
  useEffect(() => { apiFetch<{shift:Shift|null}>("/shifts/status", { method: "POST", body }).then((result) => setShift(result.shift)).catch(() => setMessage("Shift status unavailable")); }, [body]);
  async function action(path: string) {
    setMessage(null);
    try {
      const updated = await apiFetch<Shift>(path, { method: "POST", body });
      if (path.endsWith("clock-out")) { onClockOut(); return; }
      setShift(updated);
    } catch (error) { setMessage(error instanceof ApiRequestError ? error.body.message : "Time-clock action failed."); }
  }
  const onBreak = Boolean(shift?.breakStartAt && !shift.breakEndAt);
  return <div className="shift-controls"><span>{message ?? (onBreak ? "On break" : "Clocked in")}</span>
    <button type="button" onClick={() => action(onBreak ? "/shifts/break/end" : "/shifts/break/start")}>{onBreak ? "End break" : "Start break"}</button>
    <button type="button" onClick={() => action("/shifts/clock-out")}>Clock out</button>
  </div>;
}
