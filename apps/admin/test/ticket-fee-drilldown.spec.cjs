const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/management-dashboard.tsx"), "utf8");

test("revenue reports show ticket fee totals and averages by sales channel", () => {
  assert.match(source, /Ticket fees by sales channel/);
  assert.match(source, /money\(row\.ticketFeesCents\)/);
  assert.match(source, /row\.ticketFeesCents \/ row\.ticketsSold/);
  assert.match(source, /key=\{`fee-\$\{row\.channel\}`\}/);
});
