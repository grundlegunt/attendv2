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

function fallbackError(status: number, statusText: string): ApiErrorBody {
  return {
    code: "INTERNAL_ERROR",
    message: statusText.trim() || `Request failed with status ${status}.`,
  };
}

function parseErrorBody(text: string, status: number, statusText: string): ApiErrorBody {
  if (!text) return fallbackError(status, statusText);
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      parsed
      && typeof parsed === "object"
      && !Array.isArray(parsed)
      && typeof (parsed as { code?: unknown }).code === "string"
      && typeof (parsed as { message?: unknown }).message === "string"
      && (parsed as { message: string }).message.trim()
    ) {
      return parsed as ApiErrorBody;
    }
  } catch {
    // The proxy or upstream can return an HTML/text outage response.
  }
  return fallbackError(status, statusText);
}

function parseSuccessBody<T>(text: string, status: number): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiRequestError(status, {
      code: "INTERNAL_ERROR",
      message: "The server returned an invalid response. Please try again.",
    });
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
    const body = parseErrorBody(await res.text(), res.status, res.statusText);
    throw new ApiRequestError(res.status, body);
  }

  if (res.status === 204) return undefined as T;
  return parseSuccessBody<T>(await res.text(), res.status);
}
