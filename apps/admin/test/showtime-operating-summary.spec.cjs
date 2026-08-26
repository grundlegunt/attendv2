const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/scheduling/page.tsx"), "utf8");

test("selected showtimes expose operator context and film performance", () => {
  assert.match(source, /View film performance/);
  assert.match(source, /showtime-operating-summary/);
  assert.match(source, />Occupancy</);
  assert.match(source, />Sellable now</);
  assert.match(source, />Base ticket</);
  assert.match(source, />Service fee</);
});
