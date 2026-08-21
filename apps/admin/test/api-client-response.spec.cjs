const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/lib/api-client.ts"), "utf8");

test("admin API errors always retain an operator-friendly message", () => {
  assert.match(source, /statusText\.trim\(\) \|\| `Request failed with status \$\{status\}\.`/);
  assert.match(source, /parseErrorBody\(await res\.text\(\), res\.status, res\.statusText\)/);
  assert.doesNotMatch(source, /res\.json\(\)\.catch/);
});

test("admin JSON requests reject malformed success payloads predictably", () => {
  assert.match(source, /function parseSuccessBody<T>/);
  assert.match(source, /The server returned an invalid response\. Please try again\./);
  assert.match(source, /return parseSuccessBody<T>\(await res\.text\(\), res\.status\)/);
});

test("admin requests are bounded while report downloads get a longer window", () => {
  assert.match(source, /REQUEST_TIMEOUT_MS = 20_000/);
  assert.match(source, /DOWNLOAD_TIMEOUT_MS = 60_000/);
  assert.match(source, /fetchWithTimeout\(path, \{ \.\.\.init, headers \}, REQUEST_TIMEOUT_MS\)/);
  assert.match(source, /fetchWithTimeout\(path, \{ \.\.\.init, headers \}, DOWNLOAD_TIMEOUT_MS\)/);
  assert.match(source, /timeoutSignal\.aborted \? 504 : 503/);
});
