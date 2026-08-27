const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../../..");
const service = fs.readFileSync(path.join(root, "apps/api/src/platform/platform.service.ts"), "utf8");
const page = fs.readFileSync(path.join(root, "apps/platform-admin/app/films/[id]/page.tsx"), "utf8");

test("Master film intelligence exposes individual showtime performance", () => {
  assert.match(service, /showtimePerformance = reports\.flatMap/);
  assert.match(service, /metricRow\("SHOWTIME"/);
  assert.match(page, /Individual showtimes/);
  assert.match(page, /showtimePerformance\.slice\(0, 100\)/);
  assert.match(page, /showtime\.attendancePercent/);
  assert.match(page, /Export CSV includes every row/);
});
