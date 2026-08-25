const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/films/page.tsx"), "utf8");

test("Master film catalog supports discovery and lifecycle management", () => {
  assert.match(source, /\/platform\/film-catalog\?\$\{params\}/);
  assert.match(source, /includeInactive/);
  assert.match(source, /Needs review/);
  assert.match(source, /Verified by Attend/);
  assert.match(source, /Active and searchable by operators/);
});

test("Master film catalog keeps viewers read-only", () => {
  assert.match(source, /session\.user\.role === "VIEWER"/);
  assert.match(source, /disabled=\{readOnly\}/);
  assert.match(source, /\{!readOnly && <button/);
});
