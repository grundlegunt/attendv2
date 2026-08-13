"use client";

import { useEffect, useRef, useState } from "react";
import type { AuthenticatedEmployee } from "@cinema/shared";
import { apiFetch, ApiRequestError } from "./lib/api-client";

type Shift = { id: string; breakStartAt: string | null; breakEndAt: string | null };

export function ShiftControls({ employee, pin, onClockOut }: { employee: AuthenticatedEmployee; pin: string; onClockOut: () => void }) {
  const [shift, setShift] = useState<Shift | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [statusPending, setStatusPending] = useState(true);
  const [pendingAction, setPendingAction] = useState<"break" | "clock-out" | null>(null);
  const actionPendingRef = useRef(false);
  const breakStartAttemptRef = useRef<string | null>(null);
  const shiftRequestRef = useRef(0);
  const body = JSON.stringify({ locationId: employee.locationId, employeeId: employee.id, pin });
  useEffect(() => {
    const requestId = ++shiftRequestRef.current;
    actionPendingRef.current = false;
    setShift(null);
    setStatusPending(true);
    setPendingAction(null);
    setMessage(null);
    breakStartAttemptRef.current = null;
    apiFetch<{shift:Shift|null}>("/shifts/status", { method: "POST", body })
      .then((result) => {
        if (requestId !== shiftRequestRef.current) return;
        setShift(result.shift);
        setStatusPending(false);
        if (!result.shift) setMessage("No active shift");
      })
      .catch(() => {
        if (requestId !== shiftRequestRef.current) return;
        setStatusPending(false);
        setMessage("Shift status unavailable");
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
      const actionBody = path.endsWith("break/start")
        ? JSON.stringify({ locationId: employee.locationId, employeeId: employee.id, pin, requestId: breakStartAttemptRef.current ??= crypto.randomUUID() })
        : body;
      const updated = await apiFetch<Shift>(path, { method: "POST", body: actionBody });
      if (requestId !== shiftRequestRef.current) return;
      if (path.endsWith("clock-out")) { onClockOut(); return; }
      if (path.endsWith("break/start")) breakStartAttemptRef.current = null;
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
  const actionsDisabled = statusPending || !shift || pendingAction !== null;
  return <div className="shift-controls"><span>{statusPending ? "Checking shift…" : message ?? (onBreak ? "On break" : "Clocked in")}</span>
    <button type="button" disabled={actionsDisabled} onClick={() => action(onBreak ? "/shifts/break/end" : "/shifts/break/start", "break")}>
      {pendingAction === "break" ? "Updating break…" : onBreak ? "End break" : "Start break"}
    </button>
    <button type="button" disabled={actionsDisabled} onClick={() => action("/shifts/clock-out", "clock-out")}>
      {pendingAction === "clock-out" ? "Clocking out…" : "Clock out"}
    </button>
  </div>;
}
