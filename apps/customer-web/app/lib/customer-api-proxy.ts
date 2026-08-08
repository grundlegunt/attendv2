const DEFAULT_PRODUCTION_API = "https://zealous-connection-production-0896.up.railway.app/api/v1";
const DEFAULT_LOCAL_API = "http://127.0.0.1:4000/api/v1";

const REQUEST_HEADERS = [
  "accept",
  "content-type",
  "cookie",
  "idempotency-key",
  "user-agent",
  "x-request-id",
] as const;

const RESPONSE_HEADERS = [
  "cache-control",
  "content-disposition",
  "content-type",
  "etag",
  "last-modified",
  "location",
  "retry-after",
  "x-request-id",
] as const;

const CUSTOMER_API_NAMESPACES = new Set(["auth", "cinema", "customer", "public", "ticketing"]);

export interface CustomerApiProxyOptions {
  upstreamBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

export function customerApiUpstreamBaseUrl(value?: string): URL {
  const configured = value ?? process.env.CUSTOMER_API_UPSTREAM_URL ??
    (process.env.NODE_ENV === "production" ? DEFAULT_PRODUCTION_API : DEFAULT_LOCAL_API);
  const url = new URL(configured);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("CUSTOMER_API_UPSTREAM_URL must not contain credentials, a query, or a fragment.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("CUSTOMER_API_UPSTREAM_URL must use HTTPS except on localhost.");
  }
  if (url.pathname.replace(/\/$/, "") !== "/api/v1") {
    throw new Error("CUSTOMER_API_UPSTREAM_URL must target the upstream /api/v1 root.");
  }
  url.pathname = `${url.pathname.replace(/\/$/, "")}/`;
  return url;
}

export function validateCustomerApiPath(path: string[]): void {
  if (path.length === 0 || !CUSTOMER_API_NAMESPACES.has(path[0]!)) {
    throw new Error("Customer API path is not allowed.");
  }
  if (path.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\"))) {
    throw new Error("Customer API path is invalid.");
  }
  if (path[0] === "auth" && path[1] !== "customers") {
    throw new Error("Only customer authentication routes may use the customer proxy.");
  }
}

function upstreamSetCookies(headers: Headers): string[] {
  const cookieHeaders = headers as Headers & { getSetCookie?: () => string[] };
  if (cookieHeaders.getSetCookie) return cookieHeaders.getSetCookie();
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

export async function proxyCustomerApiRequest(
  request: Request,
  path: string[],
  options: CustomerApiProxyOptions = {},
): Promise<Response> {
  try {
    validateCustomerApiPath(path);
  } catch {
    return Response.json({ code: "NOT_FOUND", message: "Customer API route not found." }, { status: 404 });
  }

  const upstreamUrl = customerApiUpstreamBaseUrl(options.upstreamBaseUrl);
  upstreamUrl.pathname += path.map(encodeURIComponent).join("/");
  upstreamUrl.search = new URL(request.url).search;

  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const origin = request.headers.get("origin");
  if (origin) headers.set("origin", origin);

  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
  let upstream: Response;
  try {
    upstream = await (options.fetchImpl ?? fetch)(upstreamUrl, {
      method,
      headers,
      body: body?.byteLength ? body : undefined,
      redirect: "manual",
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "customer_api_proxy.upstream_failed", error: String(error) }));
    return Response.json(
      { code: "UPSTREAM_UNAVAILABLE", message: "Customer services are temporarily unavailable." },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  for (const cookie of upstreamSetCookies(upstream.headers)) {
    responseHeaders.append("set-cookie", cookie);
  }
  if (path[0] === "auth" || path[0] === "customer") {
    responseHeaders.set("cache-control", "private, no-store");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
