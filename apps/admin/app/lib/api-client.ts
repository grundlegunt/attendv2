import type { ApiErrorBody } from "@cinema/shared";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "production"
    ? "https://zealous-connection-production-0896.up.railway.app/api/v1"
    : "http://localhost:4000/api/v1");
const REQUEST_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

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
    // Gateways can return an HTML/text outage response instead of the API shape.
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

async function fetchWithTimeout(
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  try {
    return await fetch(`${API_BASE_URL}${path}`, { ...init, signal });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ApiRequestError(timeoutSignal.aborted ? 504 : 503, {
      code: "INTERNAL_ERROR",
      message: timeoutSignal.aborted
        ? "The request timed out. Please try again."
        : "The server could not be reached. Please try again.",
    });
  }
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { accessToken?: string },
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (init?.accessToken) headers.set("Authorization", `Bearer ${init.accessToken}`);

  const res = await fetchWithTimeout(path, { ...init, headers }, REQUEST_TIMEOUT_MS);

  if (!res.ok) {
    const body = parseErrorBody(await res.text(), res.status, res.statusText);
    throw new ApiRequestError(res.status, body);
  }

  if (res.status === 204) return undefined as T;
  return parseSuccessBody<T>(await res.text(), res.status);
}

export async function apiDownload(
  path: string,
  init?: RequestInit & { accessToken?: string },
): Promise<Blob> {
  const headers = new Headers(init?.headers);
  if (init?.accessToken) headers.set("Authorization", `Bearer ${init.accessToken}`);

  const res = await fetchWithTimeout(path, { ...init, headers }, DOWNLOAD_TIMEOUT_MS);
  if (!res.ok) {
    const body = parseErrorBody(await res.text(), res.status, res.statusText);
    throw new ApiRequestError(res.status, body);
  }
  return res.blob();
}
