import type { ApiErrorBody } from "@cinema/shared";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { accessToken?: string },
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (init?.accessToken) headers.set("Authorization", `Bearer ${init.accessToken}`);

  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({ code: "INTERNAL_ERROR", message: res.statusText }))) as ApiErrorBody;
    throw new ApiRequestError(res.status, body);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
