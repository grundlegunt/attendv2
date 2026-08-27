const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Master film intelligence compares operator film-series context", () => {
  const platform = read("apps/api/src/platform/platform.service.ts");
  const page = read("apps/platform-admin/app/films/[id]/page.tsx");

  assert.match(platform, /const seriesPerformance = new Map/);
  assert.match(platform, /if \(!showtime\.filmSeries\) continue/);
  assert.match(platform, /metricRow\("FILM SERIES"/);
  assert.match(page, /Performance inside film series/);
  assert.match(page, /performance\.seriesPerformance/);
});
