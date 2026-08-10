import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["github"]] : "list",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: [
    { command: "pnpm --filter @cinema/api start:test", url: "http://127.0.0.1:4000/api/v1/health/ready", reuseExistingServer: !process.env.CI, timeout: 120_000 },
    { command: "pnpm --filter @cinema/customer-web dev", url: "http://127.0.0.1:3000", reuseExistingServer: !process.env.CI, timeout: 120_000 },
    { command: "pnpm --filter @cinema/staff-pos dev", url: "http://127.0.0.1:3001", reuseExistingServer: !process.env.CI, timeout: 120_000 },
    { command: "pnpm --filter @cinema/kds dev", url: "http://127.0.0.1:3002", reuseExistingServer: !process.env.CI, timeout: 120_000 },
    { command: "pnpm --filter @cinema/admin dev", url: "http://127.0.0.1:3003", reuseExistingServer: !process.env.CI, timeout: 120_000 },
    { command: "NEXT_PUBLIC_API_URL=http://127.0.0.1:4000/api/v1 pnpm --filter @cinema/platform-admin dev", url: "http://127.0.0.1:3004", reuseExistingServer: !process.env.CI, timeout: 120_000 },
  ],
});
