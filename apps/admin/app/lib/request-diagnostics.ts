const STORAGE_KEY = "attend-admin-request-timings";
const TIMING_EVENT = "attend-admin-request-timing";
const RENDER_STORAGE_KEY = "attend-admin-render-timings";
const NAVIGATION_STORAGE_KEY = "attend-admin-navigation-start";
const MAX_TIMINGS = 100;

export interface AdminRequestTiming {
  page: string;
  path: string;
  method: string;
  status: number | null;
  totalMs: number;
  timeToHeadersMs: number | null;
  bodyAndParseMs: number | null;
  serverMs: number | null;
  databaseMs: number | null;
  databaseQueryCount: number | null;
  responseBytes: number | null;
  recordedAt: string;
}

export interface AdminRenderTiming {
  page: string;
  durationMs: number;
  source: "navigation" | "render";
  recordedAt: string;
}

type NavigationStart = { page: string; startedAt: number };

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
  window.sessionStorage.removeItem(RENDER_STORAGE_KEY);
  window.dispatchEvent(new Event(TIMING_EVENT));
}

export function readAdminRenderTimings(): AdminRenderTiming[] {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(RENDER_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed as AdminRenderTiming[] : [];
  } catch {
    return [];
  }
}

export function markAdminNavigationStart(page: string) {
  try {
    const start: NavigationStart = { page, startedAt: performance.now() };
    window.sessionStorage.setItem(NAVIGATION_STORAGE_KEY, JSON.stringify(start));
  } catch {
    // Navigation must continue if diagnostics storage is unavailable.
  }
}

export function recordAdminRenderTiming(page: string, renderStartedAt: number) {
  try {
    const stored: unknown = JSON.parse(window.sessionStorage.getItem(NAVIGATION_STORAGE_KEY) ?? "null");
    const navigation = stored && typeof stored === "object" && !Array.isArray(stored)
      ? stored as Partial<NavigationStart>
      : null;
    const hasNavigationStart = navigation?.page === page && typeof navigation.startedAt === "number";
    const timing: AdminRenderTiming = {
      page,
      durationMs: Math.round(performance.now() - (hasNavigationStart ? navigation.startedAt! : renderStartedAt)),
      source: hasNavigationStart ? "navigation" : "render",
      recordedAt: new Date().toISOString(),
    };
    window.sessionStorage.removeItem(NAVIGATION_STORAGE_KEY);
    window.sessionStorage.setItem(RENDER_STORAGE_KEY, JSON.stringify([timing, ...readAdminRenderTimings()].slice(0, MAX_TIMINGS)));
    window.dispatchEvent(new Event(TIMING_EVENT));
  } catch {
    // Diagnostics must never interrupt page rendering.
  }
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
  headersAt: number | null,
  response: Response | null,
) {
  try {
    const serverTiming = response?.headers.get("Server-Timing")?.match(/app;dur=([0-9.]+)/)?.[1];
    const databaseTiming = response?.headers.get("Server-Timing")?.match(/db;dur=([0-9.]+);desc="([0-9]+) queries"/);
    const completedAt = performance.now();
    const timing: AdminRequestTiming = {
      page: window.location.pathname,
      path: path.split("?")[0] ?? path,
      method,
      status: response?.status ?? null,
      totalMs: Math.round(completedAt - startedAt),
      timeToHeadersMs: headersAt === null ? null : Math.round(headersAt - startedAt),
      bodyAndParseMs: headersAt === null ? null : Math.round(completedAt - headersAt),
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
