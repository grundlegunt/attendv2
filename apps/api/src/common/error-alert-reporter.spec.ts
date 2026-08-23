import { ErrorAlertReporter, redactedErrorDetails } from "./error-alert-reporter";

describe("ErrorAlertReporter", () => {
  afterEach(() => jest.restoreAllMocks());

  it("removes the exception message while retaining a stable fingerprint and code frames", () => {
    const error = new Error("customer@example.com Bearer secret-token");
    const first = redactedErrorDetails(error);
    const second = redactedErrorDetails(error);

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.errorName).toBe("Error");
    expect(JSON.stringify(first)).not.toContain("customer@example.com");
    expect(JSON.stringify(first)).not.toContain("secret-token");
    expect(first.frames.length).toBeGreaterThan(0);
  });

  it("posts only the supplied redacted alert when configured", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const reporter = new ErrorAlertReporter("https://alerts.example.test/error");
    reporter.report({ environment: "production", errorName: "Error", fingerprint: "abc", frames: ["at service.ts:1:1"], method: "POST", path: "/api/v1/checkouts", requestId: "request-1", occurredAt: "2026-08-23T00:00:00.000Z" });
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledWith("https://alerts.example.test/error", expect.objectContaining({
      method: "POST",
      body: expect.not.stringContaining("secret"),
    }));
  });

  it("does nothing when no webhook is configured", () => {
    const fetchMock = jest.spyOn(globalThis, "fetch");
    new ErrorAlertReporter().report({ environment: "test", errorName: "Error", fingerprint: "abc", frames: [], method: "GET", path: "/", occurredAt: "2026-08-23T00:00:00.000Z" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
