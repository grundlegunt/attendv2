const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "../../..");

test("Master exposes privacy-safe audience analytics with useful funnels", () => {
  const page = readFileSync(join(root, "apps/platform-admin/app/analytics/page.tsx"), "utf8");
  const controller = readFileSync(join(root, "apps/api/src/platform/platform.controller.ts"), "utf8");
  const service = readFileSync(join(root, "apps/api/src/platform/platform.service.ts"), "utf8");
  assert.match(controller, /@Get\("audience-analytics"\)/);
  assert.match(service, /customerAnalyticsDaily\.findMany/);
  assert.match(service, /organizationId/);
  assert.match(service, /checkoutCompletionRatePercent/);
  assert.match(service, /slice\(0, 20\)/);
  assert.match(page, /Consented interactions, not unique visitors/);
  assert.match(page, /Memberships/);
  assert.match(page, /Private events/);
  assert.match(page, /Top pages/);
});

test("Master dashboard links to audience analytics", () => {
  const dashboard = readFileSync(join(root, "apps/platform-admin/app/page.tsx"), "utf8");
  assert.match(dashboard, /href="\/analytics">Audience/);
});
