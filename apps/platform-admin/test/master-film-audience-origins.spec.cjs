const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const reporting = readFileSync(resolve(__dirname, "../../api/src/reporting/reporting.service.ts"), "utf8");
const platform = readFileSync(resolve(__dirname, "../../api/src/platform/platform.service.ts"), "utf8");
const page = readFileSync(resolve(__dirname, "../app/films/[id]/page.tsx"), "utf8");

test("film intelligence aggregates privacy-safe audience ZIP origins", () => {
  assert.match(reporting, /ticketOrder: \{ select: \{ id: true, createdAt: true, channel: true, zipCode: true/);
  assert.match(reporting, /match\(\/\^\(\\d\{5\}\)\(\?:-\\d\{4\}\)\?\$\/\)/);
  assert.match(platform, /for \(const origin of report\.audienceOrigins\.origins\)/);
  assert.match(platform, /audienceTotals\.ticketsWithZip/);
  assert.match(page, /Where this film draws customers/);
  assert.match(page, /coveragePercent/);
  assert.match(page, /origin\.sharePercent/);
});
