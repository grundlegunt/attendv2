const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/platform-session.ts"), "utf8");

test("platform refreshes validate the complete session before storing it", () => {
  assert.match(source, /function isPlatformSession\(value: unknown\)/);
  assert.match(source, /return isPlatformSession\(value\) \? value : null/);
  assert.doesNotMatch(source, /refreshed\.json\(\) as StoredPlatformSession/);
});

test("platform requests normalize malformed responses", () => {
  assert.match(source, /async function readJson\(response: Response\)/);
  assert.match(source, /Request failed with status \$\{response\.status\}\./);
  assert.match(source, /The server returned an invalid response\. Please try again\./);
  assert.doesNotMatch(source, /response\.json\(\)\.catch/);
});

test("platform requests and refreshes are bounded while downloads get longer", () => {
  assert.match(source, /REQUEST_TIMEOUT_MS = 20_000/);
  assert.match(source, /DOWNLOAD_TIMEOUT_MS = 60_000/);
  assert.match(source, /fetchPlatform\(`\$\{apiBaseUrl\}\/platform\/auth\/refresh`/);
  assert.match(source, /\.catch\(\(\) => null\)/);
  assert.match(source, /accessToken, DOWNLOAD_TIMEOUT_MS/);
  assert.match(source, /The request timed out\. Please try again\./);
});
