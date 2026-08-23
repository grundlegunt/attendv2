export type ClientAppName = "customer-web" | "admin" | "platform-admin" | "staff-pos" | "kds";

type BrowserRuntime = {
  location: { pathname: string };
  fetch: (input: string, init: { method: string; headers: Record<string, string>; body: string; keepalive: boolean }) => Promise<unknown>;
};

function fingerprint(value: string) {
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < value.length; index += 1) {
    first = Math.imul(first ^ value.charCodeAt(index), 16777619);
    second = Math.imul(second ^ value.charCodeAt(index), 3266489917);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

export async function reportClientError(app: ClientAppName, error: Error, apiBaseUrl: string, runtime = globalThis as unknown as BrowserRuntime) {
  const stack = error.stack ?? error.name;
  const payload = {
    app,
    errorName: error.name || "Error",
    fingerprint: fingerprint(stack),
    // Never send the first stack line: it contains the exception message.
    frames: stack.split("\n").slice(1, 9).map((frame) => frame.trim()),
    path: runtime.location.pathname,
    occurredAt: new Date().toISOString(),
  };
  await runtime.fetch(`${apiBaseUrl.replace(/\/$/, "")}/health/client-errors`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  });
}
