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

test("ready-to-sell clients without a room open the auditorium builder", () => {
  assert.match(source, /next === "Ready to sell"/);
  assert.match(source, /configuration\.auditoriums === 0/);
  assert.match(source, /label: "Create auditorium"/);
  assert.match(source, /section=auditorium/);
});

test("onboarding exports the current filtered pipeline and its blockers", () => {
  assert.match(source, /function exportOnboardingPipeline/);
  assert.match(source, /displayedPipeline\.map/);
  assert.match(source, /Missing steps/);
  assert.match(source, /ringo-master-onboarding-/);
  assert.match(source, />Export CSV<\/button>/);
});
