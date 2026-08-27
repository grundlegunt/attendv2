const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const page = readFileSync(resolve(__dirname, "../app/audit/page.tsx"), "utf8");
const controller = readFileSync(resolve(__dirname, "../../api/src/platform/platform.controller.ts"), "utf8");
const service = readFileSync(resolve(__dirname, "../../api/src/platform/platform.service.ts"), "utf8");

test("Master audit log exports its complete filtered result as CSV", () => {
  assert.match(controller, /@Get\("audit-events\.csv"\)/);
  assert.match(controller, /filename="ringo-master-audit-log\.csv"/);
  assert.match(service, /async auditEventsCsv/);
  assert.match(service, /offset < total && offset < 10_000/);
  assert.match(page, /platformDownload/);
  assert.match(page, /\/platform\/audit-events\.csv/);
  assert.match(page, /Export CSV/);
});
