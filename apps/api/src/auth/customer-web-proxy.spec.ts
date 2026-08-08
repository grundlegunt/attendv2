import {
  customerApiUpstreamBaseUrl,
  proxyCustomerApiRequest,
  validateCustomerApiPath,
} from "../../../customer-web/app/lib/customer-api-proxy";

describe("customer-web API proxy", () => {
  it("accepts only fixed customer-facing namespaces and customer auth", () => {
    expect(() => validateCustomerApiPath(["auth", "customers", "login"])).not.toThrow();
    expect(() => validateCustomerApiPath(["customer", "restaurant-tabs", "tab-id"])).not.toThrow();
    expect(() => validateCustomerApiPath(["admin", "reports"])).toThrow();
    expect(() => validateCustomerApiPath(["auth", "staff", "login"])).toThrow();
    expect(() => validateCustomerApiPath(["cinema", "..", "admin"])).toThrow();
  });

  it("requires a fixed HTTPS upstream without credentials or URL parameters", () => {
    expect(customerApiUpstreamBaseUrl("https://api.example/api/v1").href).toBe("https://api.example/api/v1/");
    expect(() => customerApiUpstreamBaseUrl("https://user:secret@api.example/api/v1")).toThrow();
    expect(() => customerApiUpstreamBaseUrl("http://api.example/api/v1")).toThrow();
    expect(() => customerApiUpstreamBaseUrl("https://api.example/arbitrary"))
      .toThrow("must target the upstream /api/v1 root");
  });

  it("forwards cookies and customer Origin, strips proxy credentials, and preserves Set-Cookie", async () => {
    const fetchImpl = jest.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const requestHeaders = new Headers(init?.headers);
      expect(requestHeaders.get("cookie")).toBe("attend_customer_access=access-token");
      expect(requestHeaders.get("origin")).toBe("https://customer.example");
      expect(requestHeaders.get("host")).toBeNull();
      expect(requestHeaders.get("authorization")).toBeNull();
      expect(init?.redirect).toBe("manual");
      const responseHeaders = new Headers({ "content-type": "application/json" });
      responseHeaders.append("set-cookie", "attend_customer_access=new-access; Path=/api/v1; HttpOnly; Secure; SameSite=None");
      responseHeaders.append("set-cookie", "attend_customer_refresh=new-refresh; Path=/api/v1/auth/customers; HttpOnly; Secure; SameSite=None");
      return new Response(JSON.stringify({ customer: { id: "customer-id" } }), { headers: responseHeaders });
    }) as typeof fetch;

    const response = await proxyCustomerApiRequest(
      new Request("https://customer.example/api/v1/auth/customers/login?source=account", {
        method: "POST",
        headers: {
          authorization: "Bearer staff-token",
          cookie: "attend_customer_access=access-token",
          host: "attacker.example",
          origin: "https://customer.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: "customer@example.com", password: "not-a-real-password" }),
      }),
      ["auth", "customers", "login"],
      { upstreamBaseUrl: "https://api.example/api/v1", fetchImpl },
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://api.example/api/v1/auth/customers/login?source=account"),
      expect.any(Object),
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const getSetCookie = (response.headers as Headers & { getSetCookie: () => string[] }).getSetCookie();
    expect(getSetCookie).toHaveLength(2);
    expect(getSetCookie.every((cookie) => cookie.includes("HttpOnly"))).toBe(true);
  });

  it("does not invent an Origin for safe GETs that arrive without one", async () => {
    const fetchImpl = jest.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const requestHeaders = new Headers(init?.headers);
      expect(init?.method).toBe("GET");
      expect(requestHeaders.get("origin")).toBeNull();
      return Response.json({ content: { heroTitle: "Cinema" } });
    }) as typeof fetch;

    const response = await proxyCustomerApiRequest(
      new Request("http://127.0.0.1:3000/api/v1/cinema/content"),
      ["cinema", "content"],
      { upstreamBaseUrl: "http://127.0.0.1:4000/api/v1", fetchImpl },
    );

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:4000/api/v1/cinema/content"),
      expect.any(Object),
    );
  });

  it("returns 404 without contacting the upstream for disallowed paths", async () => {
    const fetchImpl = jest.fn() as typeof fetch;
    const response = await proxyCustomerApiRequest(
      new Request("https://customer.example/api/v1/platform/organizations"),
      ["platform", "organizations"],
      { upstreamBaseUrl: "https://api.example/api/v1", fetchImpl },
    );
    expect(response.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
