const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../../..");
const page = fs.readFileSync(path.join(root, "apps/platform-admin/app/films/[id]/page.tsx"), "utf8");

test("film intelligence identifies and links operator benchmarks", () => {
  assert.match(page, /Where this film performs best/);
  assert.match(page, /Best attendance/);
  assert.match(page, /Most tickets \/ show/);
  assert.match(page, /Best ticket revenue \/ show/);
  assert.match(page, /Best F&B \/ attendee/);
  assert.match(page, /\/clients\?organizationId=/);
});
