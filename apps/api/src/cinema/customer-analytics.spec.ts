import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("privacy-safe customer analytics", () => {
  const controller = readFileSync(join(__dirname, "cinema.controller.ts"), "utf8");
  const service = readFileSync(join(__dirname, "cinema.service.ts"), "utf8");

  it("accepts only an allowlisted event vocabulary behind a dedicated rate limit", () => {
    expect(controller).toContain('z.enum(["Pageview"');
    expect(controller).toContain('@RateLimit({ scope: "analytics" })');
  });

  it("stores daily counts without visitor or commerce identifiers", () => {
    expect(service).toContain("customerAnalyticsDaily.upsert");
    expect(service).toContain("publicAnalyticsPaths.has(requestedPath)");
    expect(service).toContain("acquisitionSources.has(requestedPath)");
    const model = readFileSync(join(__dirname, "../../../../packages/database/prisma/schema.prisma"), "utf8").split("model CustomerAnalyticsDaily")[1]?.split("model ")[0] ?? "";
    expect(model).not.toMatch(/customerId|orderId|ticketId|email|ipAddress|userAgent/);
  });
});
