const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/onboarding/page.tsx"), "utf8");

test("Attend Master onboarding can filter a growing client pipeline", () => {
  assert.match(source, /Find client/);
  assert.match(source, /Cinema name/);
  assert.match(source, /All clients/);
  assert.match(source, /In progress/);
  assert.match(source, /Ready to sell/);
  assert.match(source, /displayedPipeline\.map/);
  assert.match(source, /No clients match/);
  assert.match(source, /Clear filters/);
});

test("Stripe onboarding actions hand off the selected client directly", () => {
  assert.match(source, /organizationId=\$\{encodeURIComponent\(organization\.id\)\}&connect=refresh/);
  assert.match(source, /Resume Stripe/);
  assert.match(source, /Connect Stripe/);
});

test("branding and staff steps open the selected location editor", () => {
  assert.match(source, /section=branding/);
  assert.match(source, /section=staff/);
  assert.match(source, /locationId=\$\{encodeURIComponent\(location\.id\)\}/);
  assert.match(source, /find\(\(item\) => !item\.configuration\.branding\)/);
  assert.match(source, /find\(\(item\) => item\.configuration\.employees === 0\)/);
});
