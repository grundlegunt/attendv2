const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const component = fs.readFileSync(path.join(__dirname, "../app/components/optional-analytics.tsx"), "utf8");
const tracker = fs.readFileSync(path.join(__dirname, "../app/lib/optional-analytics.ts"), "utf8");

test("optional analytics is disabled without configuration and explicit consent", () => {
  assert.match(component, /if \(!scriptUrl\) return/);
  assert.match(component, /analyticsConsent === "analytics"/);
  assert.match(tracker, /dataset\.analyticsConsent === "analytics"/);
});

test("analytics uses manual pageviews so withdrawing consent stops future tracking", () => {
  assert.match(component, /autoCapturePageviews: false/);
  assert.match(component, /attend:analytics-consent/);
});

test("identifier-bearing customer routes are redacted and query strings are excluded", () => {
  assert.match(tracker, /\/movie\/:movieId/);
  assert.match(tracker, /\/film-series\/:seriesId/);
  assert.match(tracker, /\/tickets\/:orderId/);
  assert.doesNotMatch(tracker, /location\.search/);
});
