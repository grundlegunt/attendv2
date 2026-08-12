"use client";

import { useEffect, useRef, useState } from "react";
import type { AuthenticatedEmployee } from "@cinema/shared";
import { apiFetch, ApiRequestError } from "./lib/api-client";

type Shift = { id: string; breakStartAt: string | null; breakEndAt: string | null };

export function ShiftControls({ employee, pin, onClockOut }: { employee: AuthenticatedEmployee; pin: string; onClockOut: () => void }) {
  const [shift, setShift] = useState<Shift | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"break" | "clock-out" | null>(null);
  const actionPendingRef = useRef(false);
  const shiftRequestRef = useRef(0);
  const body = JSON.stringify({ locationId: employee.locationId, employeeId: employee.id, pin });
  useEffect(() => {
    const requestId = ++shiftRequestRef.current;
    apiFetch<{shift:Shift|null}>("/shifts/status", { method: "POST", body })
      .then((result) => {
        if (requestId === shiftRequestRef.current) setShift(result.shift);
      })
      .catch(() => {
        if (requestId === shiftRequestRef.current) setMessage("Shift status unavailable");
      });
    return () => { shiftRequestRef.current += 1; };
  }, [body]);
  async function action(path: string, actionName: "break" | "clock-out") {
    if (actionPendingRef.current) return;
    actionPendingRef.current = true;
    const requestId = ++shiftRequestRef.current;
    setPendingAction(actionName);
    setMessage(null);
    try {
      const updated = await apiFetch<Shift>(path, { method: "POST", body });
      if (requestId !== shiftRequestRef.current) return;
      if (path.endsWith("clock-out")) { onClockOut(); return; }
      setShift(updated);
    } catch (error) {
      if (requestId !== shiftRequestRef.current) return;
      setMessage(error instanceof ApiRequestError ? error.body.message : "Time-clock action failed.");
    } finally {
      if (requestId === shiftRequestRef.current) {
        actionPendingRef.current = false;
        setPendingAction(null);
      }
    }
  }
  const onBreak = Boolean(shift?.breakStartAt && !shift.breakEndAt);
  return <div className="shift-controls"><span>{message ?? (onBreak ? "On break" : "Clocked in")}</span>
    <button type="button" disabled={pendingAction !== null} onClick={() => action(onBreak ? "/shifts/break/end" : "/shifts/break/start", "break")}>
      {pendingAction === "break" ? "Updating break…" : onBreak ? "End break" : "Start break"}
    </button>
    <button type="button" disabled={pendingAction !== null} onClick={() => action("/shifts/clock-out", "clock-out")}>
      {pendingAction === "clock-out" ? "Clocking out…" : "Clock out"}
    </button>
  </div>;
}
