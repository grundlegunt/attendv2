import type { ApiErrorBody } from "@cinema/shared";

const API_BASE_URL = "/api/v1";

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }
}

/** Thin fetch wrapper — every frontend app uses the same shape of client. */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { accessToken?: string },
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (init?.accessToken) headers.set("Authorization", `Bearer ${init.accessToken}`);

  let scopedPath = path;
  if (typeof window !== "undefined") {
    const requestedLocationId = new URLSearchParams(window.location.search).get("locationId");
    if (requestedLocationId) window.sessionStorage.setItem("attend-customer-location", requestedLocationId);
    const locationId = requestedLocationId ?? window.sessionStorage.getItem("attend-customer-location") ?? process.env.NEXT_PUBLIC_LOCATION_ID;
    if (locationId && !new URL(path, window.location.origin).searchParams.has("locationId")) {
      scopedPath += `${path.includes("?") ? "&" : "?"}locationId=${encodeURIComponent(locationId)}`;
    }
  }

  const res = await fetch(`${API_BASE_URL}${scopedPath}`, { ...init, headers, credentials: "include" });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({ code: "INTERNAL_ERROR", message: res.statusText }))) as ApiErrorBody;
    throw new ApiRequestError(res.status, body);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
