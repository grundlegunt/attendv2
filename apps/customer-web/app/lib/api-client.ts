import type { ApiErrorBody } from "@cinema/shared";

function apiBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (process.env.NODE_ENV === "production") {
    return "https://zealous-connection-production-0896.up.railway.app/api/v1";
  }
  const hostname = typeof window === "undefined" ? "localhost" : window.location.hostname;
  return `http://${hostname}:4000/api/v1`;
}

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

  const res = await fetch(`${apiBaseUrl()}${path}`, { ...init, headers, credentials: "include" });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({ code: "INTERNAL_ERROR", message: res.statusText }))) as ApiErrorBody;
    throw new ApiRequestError(res.status, body);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
