export type PlatformRole = "OWNER" | "OPERATOR" | "VIEWER";

export interface StoredPlatformSession {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; email: string; role: PlatformRole };
}

let refreshInFlight: Promise<StoredPlatformSession | null> | null = null;
const REQUEST_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const TIMING_STORAGE_KEY = "attend-platform-request-timings";
const TIMING_EVENT = "attend-platform-request-timing";

export interface PlatformRequestTiming {
  path: string;
  status: number | null;
  totalMs: number;
  serverMs: number | null;
  recordedAt: string;
}

export function readPlatformRequestTimings(): PlatformRequestTiming[] {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(TIMING_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed as PlatformRequestTiming[] : [];
  } catch { return []; }
}

export function clearPlatformRequestTimings() {
  window.sessionStorage.removeItem(TIMING_STORAGE_KEY);
  window.dispatchEvent(new Event(TIMING_EVENT));
}

export function platformRequestTimingEvent() { return TIMING_EVENT; }

function recordPlatformRequestTiming(path: string, startedAt: number, response: Response | null) {
  try {
    const serverTiming = response?.headers.get("Server-Timing")?.match(/app;dur=([0-9.]+)/)?.[1];
    const timing: PlatformRequestTiming = { path: path.split("?")[0] ?? path, status: response?.status ?? null, totalMs: Math.round(performance.now() - startedAt), serverMs: serverTiming ? Number(serverTiming) : null, recordedAt: new Date().toISOString() };
    window.sessionStorage.setItem(TIMING_STORAGE_KEY, JSON.stringify([timing, ...readPlatformRequestTimings()].slice(0, 100)));
    window.dispatchEvent(new Event(TIMING_EVENT));
  } catch {
    // Diagnostics must never interrupt an operational request.
  }
}

async function fetchPlatform(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  try {
    return await fetch(url, { ...init, signal });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new Error(
      timeoutSignal.aborted
        ? "The request timed out. Please try again."
        : "The server could not be reached. Please try again.",
      { cause: error },
    );
  }
}

function isPlatformSession(value: unknown): value is StoredPlatformSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const session = value as Partial<StoredPlatformSession>;
  const role = session.user?.role;
  return typeof session.accessToken === "string"
    && typeof session.refreshToken === "string"
    && typeof session.user?.id === "string"
    && typeof session.user.name === "string"
    && typeof session.user.email === "string"
    && Boolean(role && ["OWNER", "OPERATOR", "VIEWER"].includes(role));
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function platformErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fallback;
  const error = body as {
    message?: unknown;
    details?: { issues?: unknown };
  };
  const message =
    typeof error.message === "string" && error.message.trim()
      ? error.message.trim()
      : fallback;
  if (!Array.isArray(error.details?.issues)) return message;

  const issues = error.details.issues.flatMap((issue) => {
    if (!issue || typeof issue !== "object" || Array.isArray(issue)) return [];
    const candidate = issue as { path?: unknown; message?: unknown };
    if (typeof candidate.message !== "string" || !candidate.message.trim()) {
      return [];
    }
    const path = Array.isArray(candidate.path)
      ? candidate.path
          .filter((part): part is string | number =>
            typeof part === "string" || typeof part === "number",
          )
          .join(".")
      : "";
    return [`${path ? `${path}: ` : ""}${candidate.message.trim()}`];
  });

  return issues.length > 0 ? issues.join(" ") : message;
}

export function readPlatformSession(storageKey: string): StoredPlatformSession | null {
  const stored = window.sessionStorage.getItem(storageKey);
  if (!stored) return null;
  try {
    const value: unknown = JSON.parse(stored);
    if (!isPlatformSession(value)) {
      throw new Error("Stored Attend Master session is incompatible.");
    }
    return value;
  } catch {
    window.sessionStorage.removeItem(storageKey);
    return null;
  }
}

async function platformResponse(apiBaseUrl: string, storageKey: string, path: string, init?: RequestInit, accessToken?: string, timeoutMs = REQUEST_TIMEOUT_MS) {
  const startedAt = performance.now();
  let response: Response | null = null;
  let recorded = false;
  const send = (token?: string) => {
    const headers = new Headers(init?.headers);
    headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetchPlatform(`${apiBaseUrl}${path}`, { ...init, headers }, timeoutMs);
  };
  const stored = accessToken ? readPlatformSession(storageKey) : null;
  try {
  response = await send(stored?.accessToken ?? accessToken);
  if (response.status === 401 && accessToken) {
    const session = readPlatformSession(storageKey);
    if (session) {
      refreshInFlight ??= fetchPlatform(`${apiBaseUrl}/platform/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: session.refreshToken }),
        }, REQUEST_TIMEOUT_MS)
        .then(async (refreshed) => {
          if (!refreshed.ok) return null;
          const value = await readJson(refreshed);
          return isPlatformSession(value) ? value : null;
        })
        .catch(() => null)
        .finally(() => { refreshInFlight = null; });
      const next = await refreshInFlight;
      if (next) {
        window.sessionStorage.setItem(storageKey, JSON.stringify(next));
        response = await send(next.accessToken);
      } else {
        window.sessionStorage.removeItem(storageKey);
      }
    }
  }
  if (!response.ok) {
    const body = await readJson(response);
    const message = platformErrorMessage(
      body,
      response.statusText.trim() || `Request failed with status ${response.status}.`,
    );
    throw new Error(message);
  }
  recordPlatformRequestTiming(path, startedAt, response);
  recorded = true;
  return response;
  } finally {
    if (!recorded) recordPlatformRequestTiming(path, startedAt, response);
  }
}

export async function platformRequest<T>(apiBaseUrl: string, storageKey: string, path: string, init?: RequestInit, accessToken?: string): Promise<T> {
  const response = await platformResponse(apiBaseUrl, storageKey, path, init, accessToken);
  if (response.status === 204) return undefined as T;
  const body = await readJson(response);
  if (body === null) throw new Error("The server returned an invalid response. Please try again.");
  return body as T;
}

export async function platformDownload(apiBaseUrl: string, storageKey: string, path: string, accessToken: string) {
  return (await platformResponse(apiBaseUrl, storageKey, path, undefined, accessToken, DOWNLOAD_TIMEOUT_MS)).blob();
}

export async function revokePlatformSession(apiBaseUrl: string, accessToken: string | undefined): Promise<void> {
  if (!accessToken) return;
  try {
    await fetchPlatform(`${apiBaseUrl}/platform/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    }, REQUEST_TIMEOUT_MS);
  } catch {
    // Local sign-out must still complete if the API is unavailable.
  }
}
