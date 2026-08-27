const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../../..");
const controller = fs.readFileSync(path.join(root, "apps/api/src/platform/platform.controller.ts"), "utf8");
const service = fs.readFileSync(path.join(root, "apps/api/src/platform/platform.service.ts"), "utf8");
const page = fs.readFileSync(path.join(root, "apps/platform-admin/app/films/[id]/page.tsx"), "utf8");

test("Master film intelligence has an authenticated CSV export", () => {
  assert.match(controller, /film-catalog\/:entryId\/performance\.csv/);
  assert.match(controller, /ringo-master-film-performance\.csv/);
  assert.match(service, /metricRow\("TOTAL"/);
  assert.match(service, /metricRow\("OPERATOR"/);
  assert.match(service, /metricRow\("WEEK"/);
  assert.match(service, /metricRow\("F&B ITEM"/);
  assert.match(page, /platformDownload/);
  assert.match(page, /Export CSV/);
});
