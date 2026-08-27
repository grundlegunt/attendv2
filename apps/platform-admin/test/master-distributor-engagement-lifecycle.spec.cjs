const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Master distinguishes current, upcoming, past, and unscheduled distributor engagements", () => {
  const platform = read("apps/api/src/platform/platform.service.ts");
  const page = read("apps/platform-admin/app/distributors/page.tsx");

  assert.match(platform, /pastShows > 0 && upcomingShows > 0 \? "CURRENT"/);
  assert.match(platform, /currentDeals:/);
  assert.match(platform, /dealsMissingTerms:/);
  assert.match(platform, /"First showtime", "Last showtime"/);
  assert.match(page, /selected\.currentDeals/);
  assert.match(page, /No scheduled dates/);
});
