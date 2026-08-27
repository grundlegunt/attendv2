const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Master compares distributor engagement attendance and economics", () => {
  const platform = read("apps/api/src/platform/platform.service.ts");
  const page = read("apps/platform-admin/app/distributors/page.tsx");

  assert.match(platform, /auditorium: \{ select: \{ capacity: true/);
  assert.match(platform, /attendancePercent: capacity \? Math\.round/);
  assert.match(platform, /averageTicketsPerShow:/);
  assert.match(platform, /averageTicketPriceCents:/);
  assert.match(platform, /effectiveDistributorSharePercent:/);
  assert.match(platform, /"Attendance percent", "Average tickets per show", "Average ticket price \(cents\)", "Effective distributor share percent"/);
  assert.match(page, /deal\.attendancePercent/);
  assert.match(page, /deal\.averageTicketsPerShow/);
  assert.match(page, /deal\.effectiveDistributorSharePercent/);
});
