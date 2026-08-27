const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Master film intelligence exposes auditorium programming fit", () => {
  const platform = read("apps/api/src/platform/platform.service.ts");
  const page = read("apps/platform-admin/app/films/[id]/page.tsx");

  assert.match(platform, /report\.auditoriumPerformance\.map/);
  assert.match(platform, /auditoriumPerformance,/);
  assert.match(platform, /metricRow\("AUDITORIUM"/);
  assert.match(page, /Performance by auditorium/);
  assert.match(page, /averageTicketRevenuePerShowCents/);
  assert.match(page, /averageFnbPerShowCents/);
});
