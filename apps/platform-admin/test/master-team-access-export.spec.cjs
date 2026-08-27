const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const source = readFileSync(resolve(__dirname, "../app/team/page.tsx"), "utf8");

test("Master filters and exports company access without credentials", () => {
  assert.match(source, /displayedUsers/);
  assert.match(source, /roleFilter/);
  assert.match(source, /accessFilter/);
  assert.match(source, /function exportTeamAccess/);
  assert.match(source, /ringo-master-team-access-/);
  assert.match(source, /onClick=\{exportTeamAccess\}/);
  assert.doesNotMatch(source, /const headers = \[[^\]]*password/i);
});
