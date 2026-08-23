import { reportClientError } from "./client-error-reporting";

describe("reportClientError", () => {
  it("omits exception messages and URL queries from browser reports", async () => {
    const calls: Array<{ input: string; body: string }> = [];
    const runtime = {
      location: { pathname: "/checkout" },
      fetch: async (input: string, init: { body: string }) => { calls.push({ input, body: init.body }); },
    };
    const error = new Error("customer@example.com card-secret");

    await reportClientError("customer-web", error, "/api/v1/", runtime as never);

    expect(calls[0]?.input).toBe("/api/v1/health/client-errors");
    expect(calls[0]?.body).not.toContain("customer@example.com");
    expect(calls[0]?.body).not.toContain("card-secret");
    expect(JSON.parse(calls[0]!.body)).toMatchObject({ app: "customer-web", path: "/checkout", errorName: "Error" });
  });
});
