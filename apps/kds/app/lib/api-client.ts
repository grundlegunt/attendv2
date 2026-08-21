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

export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { accessToken?: string },
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (init?.accessToken) headers.set("Authorization", `Bearer ${init.accessToken}`);

  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });

  if (!res.ok) {
    const body = parseErrorBody(await res.text(), res.status, res.statusText);
    throw new ApiRequestError(res.status, body);
  }

  if (res.status === 204) return undefined as T;
  return parseSuccessBody<T>(await res.text(), res.status);
}

export function subscribeToStationEvents(
  kitchenStationId: string,
  accessToken: string,
  onEvent: () => void,
) {
  const controller = new AbortController();
  void fetch(`${API_BASE_URL}/fulfillment/stations/${kitchenStationId}/events`, {
    headers: {
      Accept: "text/event-stream",
      Authorization: `Bearer ${accessToken}`,
    },
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok || !response.body) return;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        if (events.some((event) => event.includes("data:"))) onEvent();
      }
    })
    .catch(() => {
      // The queue's periodic authoritative refetch is the reconnect fallback.
    });
  return () => controller.abort();
}
