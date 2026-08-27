const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const source = readFileSync(resolve(__dirname, "../app/clients/clients-page.tsx"), "utf8");

test("Master exports the currently filtered client directory", () => {
  assert.match(source, /function exportClientDirectory/);
  assert.match(source, /filteredOrganizations\.map/);
  assert.match(source, /ringo-master-clients-/);
  assert.match(source, /Stripe onboarding status/);
  assert.match(source, /Default admission model/);
  assert.match(source, /Upcoming showtimes/);
  assert.match(source, /onClick=\{exportClientDirectory\}/);
});
