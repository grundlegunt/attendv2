const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
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
  assert.match(page, /Daily customer activity/);
  assert.match(controller, /@Get\("audience-analytics\.csv"\)/);
  assert.match(service, /audienceAnalyticsCsv\(/);
  assert.match(service, /Top page/);
  assert.match(page, /ringo-master-audience-\$\{from\}-to-\$\{to\}\.csv/);
  assert.match(page, />Export CSV<\/button>/);
});

test("Audience is reachable from every Master navigation bar", () => {
  const app = join(root, "apps/platform-admin/app");
  const pages = [];
  function collect(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) collect(path);
      else if (entry.name.endsWith(".tsx")) pages.push(path);
    }
  }
  collect(app);
  for (const path of pages) {
    const source = readFileSync(path, "utf8");
    if (source.includes('className="platform-nav"')) assert.match(source, /href="\/analytics"/, path);
  }
});

test("Master dashboard links to audience analytics", () => {
  const dashboard = readFileSync(join(root, "apps/platform-admin/app/page.tsx"), "utf8");
  assert.match(dashboard, /href="\/analytics">Audience/);
});
