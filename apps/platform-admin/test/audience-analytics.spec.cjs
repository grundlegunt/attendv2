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
  assert.match(service, /seatToCheckoutRatePercent/);
  assert.match(service, /paymentFormReadyRatePercent/);
  assert.match(service, /paymentCompletionRatePercent/);
  assert.match(service, /slice\(0, 20\)/);
  assert.match(page, /Consented interactions, not unique visitors/);
  assert.match(page, /Memberships/);
  assert.match(page, /Private events/);
  assert.match(page, /Top pages/);
  assert.match(page, /Daily customer activity/);
  assert.match(page, /Seats continued/);
  assert.match(page, /Payment ready/);
  assert.match(controller, /@Get\("audience-analytics\.csv"\)/);
  assert.match(service, /audienceAnalyticsCsv\(/);
  assert.match(service, /Top page/);
  assert.match(service, /Acquisition Source/);
  assert.match(service, /Acquisition source/);
  assert.match(page, /How customers arrived/);
  assert.match(page, /Leading acquisition source by location/);
  assert.match(service, /location\.sources\.set/);
  assert.match(service, /location\.sources\.map/);
  assert.match(service, /sourcesByDay/);
  assert.match(page, /Leading source by day/);
  assert.match(page, /raw referrers, or campaign parameters/);
  assert.match(page, /ringo-master-audience-\$\{from\}-to-\$\{to\}\.csv/);
  assert.match(page, />Export CSV<\/button>/);
});

test("Audience is reachable from every Master navigation bar", () => {
  const app = join(root, "apps/platform-admin/app");
  const sharedNav = readFileSync(join(app, "platform-nav.tsx"), "utf8");
  const pages = [];
  function collect(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) collect(path);
      else if (entry.name.endsWith(".tsx")) pages.push(path);
    }
  }
  collect(app);
  assert.match(sharedNav, /href, label/);
  assert.match(sharedNav, /\["\/analytics", "Audience"\]/);
  for (const path of pages) {
    const source = readFileSync(path, "utf8");
    if (source.includes('className="platform-nav"') && !path.endsWith("platform-nav.tsx")) {
      assert.match(source, /href="\/analytics"/, path);
    }
  }
});

test("Master dashboard links to audience analytics", () => {
  const dashboard = readFileSync(join(root, "apps/platform-admin/app/page.tsx"), "utf8");
  assert.match(dashboard, /import \{ PlatformNav \} from "\.\/platform-nav"/);
  assert.match(dashboard, /<PlatformNav role=\{session\.user\.role\} \/>/);
});
