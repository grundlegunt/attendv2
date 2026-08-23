import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("client error reporting", () => {
  it("accepts only redacted metadata through a rate-limited endpoint", () => {
    const source = readFileSync(resolve(__dirname, "health.controller.ts"), "utf8");
    expect(source).toContain('@Post("client-errors")');
    expect(source).toContain('@RateLimit({ scope: "observability" })');
    expect(source).not.toContain("message: parsed.data");
  });

  it.each(["customer-web", "admin", "platform-admin", "staff-pos", "kds"])("captures %s root crashes", (app) => {
    const source = readFileSync(resolve(__dirname, `../../../${app}/app/global-error.tsx`), "utf8");
    expect(source).toContain(`reportClientError("${app}"`);
    expect(source).toContain("Try again");
  });
});
