import { isCorsOriginAllowed } from "./cors-origin";

describe("isCorsOriginAllowed", () => {
  const configuredOrigins = ["https://attendv2-admin.vercel.app", "http://localhost:3003"];

  it("allows requests without a browser origin", () => {
    expect(isCorsOriginAllowed(undefined, configuredOrigins)).toBe(true);
  });

  it("allows explicitly configured origins", () => {
    expect(isCorsOriginAllowed("https://attendv2-admin.vercel.app", configuredOrigins)).toBe(true);
  });

  it("allows this project's production Vercel aliases", () => {
    expect(isCorsOriginAllowed("https://attend-master-attend3.vercel.app", configuredOrigins)).toBe(true);
    expect(isCorsOriginAllowed("https://attendv2-admin-attend3.vercel.app", configuredOrigins)).toBe(true);
    expect(isCorsOriginAllowed("https://attendv2-attend3.vercel.app", configuredOrigins)).toBe(true);
  });

  it("allows the configured loopback hostname used by browser journeys", () => {
    expect(isCorsOriginAllowed("http://127.0.0.1:3000", ["http://127.0.0.1:3000"])).toBe(true);
  });

  it("allows this project's Vercel customer, cinema admin, and Attend Master preview aliases", () => {
    expect(
      isCorsOriginAllowed(
        "https://attendv2-admin-git-agent-admin-calendar-scheduling-attend3.vercel.app",
        configuredOrigins,
      ),
    ).toBe(true);
    expect(isCorsOriginAllowed("https://attendv2-git-feature-attend3.vercel.app", configuredOrigins)).toBe(true);
    expect(isCorsOriginAllowed("https://attendv2-lucfq0892-attend3.vercel.app", configuredOrigins)).toBe(true);
    expect(
      isCorsOriginAllowed(
        "https://attend-master-git-feat-platform-cinema-management-attend3.vercel.app",
        configuredOrigins,
      ),
    ).toBe(true);
    expect(isCorsOriginAllowed("https://attendv2-admin-feature-other-team.vercel.app", configuredOrigins)).toBe(false);
    expect(isCorsOriginAllowed("https://attendv2-feature-other-team.vercel.app", configuredOrigins)).toBe(false);
    expect(isCorsOriginAllowed("https://attend-master-feature-other-team.vercel.app", configuredOrigins)).toBe(false);
  });

  it("rejects unrelated origins", () => {
    expect(isCorsOriginAllowed("https://example.com", configuredOrigins)).toBe(false);
  });
});
