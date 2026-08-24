const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/cinema-setup/page.tsx"), "utf8");

test("cinema Admin renders the editable auditorium builder", () => {
  assert.match(source, /import \{ AuditoriumBuilder \}/);
  assert.match(source, /<AuditoriumBuilder/);
  assert.match(source, /auditoriums=\{data\?\.location\.auditoriums \?\? \[\]\}/);
  assert.match(source, /onSaved=\{async \(message\)/);
  assert.doesNotMatch(source, /Theater structure is read-only here/);
  assert.doesNotMatch(source, /MANAGED IN ATTEND MASTER/);
});
