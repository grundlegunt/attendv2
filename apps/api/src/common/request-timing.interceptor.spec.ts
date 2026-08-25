import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("request timing observability", () => {
  it("publishes browser timing and logs slow API requests without query values", () => {
    const source = readFileSync(resolve(__dirname, "request-timing.interceptor.ts"), "utf8");
    expect(source).toMatch(/response\.setHeader\(\s*"Server-Timing"/);
    expect(source).toContain('logger.warn("Slow API request"');
    expect(source).toContain('db;dur=${databaseTiming.durationMs.toFixed(1)}');
    expect(source).toContain("databaseQueryCount: databaseTiming.queryCount");
    expect(source).toContain("path: request.path");
    expect(source).not.toContain("originalUrl");
  });
});
