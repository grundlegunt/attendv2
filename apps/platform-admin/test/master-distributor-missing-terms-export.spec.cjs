const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const root = join(__dirname, "../../..");
const service = readFileSync(join(root, "apps/api/src/platform/platform.service.ts"), "utf8");
const controller = readFileSync(join(root, "apps/api/src/platform/platform.controller.ts"), "utf8");
const page = readFileSync(join(root, "apps/platform-admin/app/distributors/page.tsx"), "utf8");

test("Master exports a focused missing distributor terms queue", () => {
  assert.match(controller, /@Get\("distributors\/missing-terms\.csv"\)/);
  assert.match(service, /distributorMissingTermsCsv/);
  assert.match(service, /\.filter\(\(deal\) => !Array\.isArray\(deal\.terms\) \|\| deal\.terms\.length === 0\)/);
  assert.match(page, /Export missing terms/);
  assert.match(page, /`\/platform\/distributors\/missing-terms\.csv\$\{rangeQuery\(range\)\}`/);
});
