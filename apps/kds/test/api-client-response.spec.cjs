const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/lib/api-client.ts"), "utf8");

test("KDS API failures always retain a useful kitchen-facing message", () => {
  assert.match(source, /statusText\.trim\(\) \|\| `Request failed with status \$\{status\}\.`/);
  assert.match(source, /parseErrorBody\(await res\.text\(\), res\.status, res\.statusText\)/);
  assert.doesNotMatch(source, /res\.json\(\)\.catch/);
});

test("KDS rejects malformed successful JSON predictably", () => {
  assert.match(source, /function parseSuccessBody<T>/);
  assert.match(source, /The server returned an invalid response\. Please try again\./);
  assert.match(source, /return parseSuccessBody<T>\(await res\.text\(\), res\.status\)/);
});

test("KDS commands time out without bounding the event stream", () => {
  assert.match(source, /REQUEST_TIMEOUT_MS = 20_000/);
  assert.match(source, /timeoutSignal\.aborted \? 504 : 503/);
  assert.match(source, /const res = await fetchWithTimeout\(path, \{ \.\.\.init, headers \}\)/);
  assert.match(source, /void fetch\(`\$\{API_BASE_URL\}\/fulfillment\/stations\/\$\{kitchenStationId\}\/events`/);
});
