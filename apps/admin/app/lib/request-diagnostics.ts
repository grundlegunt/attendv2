const STORAGE_KEY = "attend-admin-request-timings";
const TIMING_EVENT = "attend-admin-request-timing";
const MAX_TIMINGS = 100;

export interface AdminRequestTiming {
  page: string;
  path: string;
  method: string;
  status: number | null;
  totalMs: number;
  serverMs: number | null;
  databaseMs: number | null;
  databaseQueryCount: number | null;
  responseBytes: number | null;
  recordedAt: string;
}

export function readAdminRequestTimings(): AdminRequestTiming[] {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed as AdminRequestTiming[] : [];
  } catch {
    return [];
  }
}

export function clearAdminRequestTimings() {
  window.sessionStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(TIMING_EVENT));
}

export function adminRequestTimingEvent() {
  return TIMING_EVENT;
}

function numericHeader(response: Response | null, name: string): number | null {
  const value = response?.headers.get(name);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function recordAdminRequestTiming(
  path: string,
  method: string,
  startedAt: number,
  response: Response | null,
) {
  try {
    const serverTiming = response?.headers.get("Server-Timing")?.match(/app;dur=([0-9.]+)/)?.[1];
    const databaseTiming = response?.headers.get("Server-Timing")?.match(/db;dur=([0-9.]+);desc="([0-9]+) queries"/);
    const timing: AdminRequestTiming = {
      page: window.location.pathname,
      path: path.split("?")[0] ?? path,
      method,
      status: response?.status ?? null,
      totalMs: Math.round(performance.now() - startedAt),
      serverMs: serverTiming ? Number(serverTiming) : null,
      databaseMs: databaseTiming ? Number(databaseTiming[1]) : null,
      databaseQueryCount: databaseTiming ? Number(databaseTiming[2]) : null,
      responseBytes: numericHeader(response, "Content-Length"),
      recordedAt: new Date().toISOString(),
    };
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([timing, ...readAdminRequestTimings()].slice(0, MAX_TIMINGS)),
    );
    window.dispatchEvent(new Event(TIMING_EVENT));
  } catch {
    // Diagnostics must never interrupt an operational request.
  }
}
