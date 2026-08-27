const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("film performance preserves and compares screening formats", () => {
  const reporting = read("apps/api/src/reporting/reporting.service.ts");
  const platform = read("apps/api/src/platform/platform.service.ts");
  const page = read("apps/platform-admin/app/films/[id]/page.tsx");

  assert.match(reporting, /presentation: showtime\.presentation, format: showtime\.format/);
  assert.match(reporting, /const formatPerformance = new Map/);
  assert.match(platform, /report\.formatPerformance/);
  assert.match(platform, /metricRow\("SCREENING FORMAT"/);
  assert.match(page, /Performance by screening format/);
});
