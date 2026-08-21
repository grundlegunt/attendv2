export type PlatformRole = "OWNER" | "OPERATOR" | "VIEWER";

export interface StoredPlatformSession {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; email: string; role: PlatformRole };
}

let refreshInFlight: Promise<StoredPlatformSession | null> | null = null;

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

async function platformResponse(apiBaseUrl: string, storageKey: string, path: string, init?: RequestInit, accessToken?: string) {
  const send = (token?: string) => {
    const headers = new Headers(init?.headers);
    headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(`${apiBaseUrl}${path}`, { ...init, headers });
  };
  const stored = accessToken ? readPlatformSession(storageKey) : null;
  let response = await send(stored?.accessToken ?? accessToken);
  if (response.status === 401 && accessToken) {
    const session = readPlatformSession(storageKey);
    if (session) {
      refreshInFlight ??= fetch(`${apiBaseUrl}/platform/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: session.refreshToken }),
        })
        .then(async (refreshed) => {
          if (!refreshed.ok) return null;
          const value = await readJson(refreshed);
          return isPlatformSession(value) ? value : null;
        })
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
    const message = body && typeof body === "object" && !Array.isArray(body)
      && typeof (body as { message?: unknown }).message === "string"
      && (body as { message: string }).message.trim()
      ? (body as { message: string }).message
      : response.statusText.trim() || `Request failed with status ${response.status}.`;
    throw new Error(message);
  }
  return response;
}

export async function platformRequest<T>(apiBaseUrl: string, storageKey: string, path: string, init?: RequestInit, accessToken?: string): Promise<T> {
  const response = await platformResponse(apiBaseUrl, storageKey, path, init, accessToken);
  if (response.status === 204) return undefined as T;
  const body = await readJson(response);
  if (body === null) throw new Error("The server returned an invalid response. Please try again.");
  return body as T;
}

export async function platformDownload(apiBaseUrl: string, storageKey: string, path: string, accessToken: string) {
  return (await platformResponse(apiBaseUrl, storageKey, path, undefined, accessToken)).blob();
}
