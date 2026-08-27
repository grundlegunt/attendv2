const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Master compares canonical film performance by operator price tier", () => {
  const reporting = read("apps/api/src/reporting/reporting.service.ts");
  const platform = read("apps/api/src/platform/platform.service.ts");
  const page = read("apps/platform-admin/app/films/[id]/page.tsx");

  assert.match(reporting, /priceTier: \{ select:/);
  assert.match(reporting, /const priceTierPerformance = new Map/);
  assert.match(platform, /report\.priceTierPerformance/);
  assert.match(platform, /metricRow\("PRICE TIER"/);
  assert.match(page, /Performance by price tier/);
});
