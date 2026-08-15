export type PlatformRole = "OWNER" | "OPERATOR" | "VIEWER";

export interface StoredPlatformSession {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; email: string; role: PlatformRole };
}

let refreshInFlight: Promise<StoredPlatformSession | null> | null = null;

export function readPlatformSession(storageKey: string): StoredPlatformSession | null {
  const stored = window.sessionStorage.getItem(storageKey);
  if (!stored) return null;
  try {
    const value = JSON.parse(stored) as Partial<StoredPlatformSession>;
    const role = value.user?.role;
    if (typeof value.accessToken !== "string" || typeof value.refreshToken !== "string" || typeof value.user?.id !== "string" || typeof value.user.name !== "string" || typeof value.user.email !== "string" || !role || !["OWNER", "OPERATOR", "VIEWER"].includes(role)) {
      throw new Error("Stored Attend Master session is incompatible.");
    }
    return value as StoredPlatformSession;
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
        .then(async (refreshed) => refreshed.ok ? await refreshed.json() as StoredPlatformSession : null)
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
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(typeof body.message === "string" ? body.message : "Request failed.");
  }
  return response;
}

export async function platformRequest<T>(apiBaseUrl: string, storageKey: string, path: string, init?: RequestInit, accessToken?: string): Promise<T> {
  const response = await platformResponse(apiBaseUrl, storageKey, path, init, accessToken);
  return response.json() as Promise<T>;
}

export async function platformDownload(apiBaseUrl: string, storageKey: string, path: string, accessToken: string) {
  return (await platformResponse(apiBaseUrl, storageKey, path, undefined, accessToken)).blob();
}
