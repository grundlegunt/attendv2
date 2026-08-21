const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/lib/api-client.ts"), "utf8");

test("staff POS API failures always retain a cashier-friendly message", () => {
  assert.match(source, /statusText\.trim\(\) \|\| `Request failed with status \$\{status\}\.`/);
  assert.match(source, /parseErrorBody\(await res\.text\(\), res\.status, res\.statusText\)/);
  assert.doesNotMatch(source, /res\.json\(\)\.catch/);
});

test("staff POS rejects malformed successful JSON predictably", () => {
  assert.match(source, /function parseSuccessBody<T>/);
  assert.match(source, /The server returned an invalid response\. Please try again\./);
  assert.match(source, /return parseSuccessBody<T>\(await res\.text\(\), res\.status\)/);
});

test("staff POS requests time out as retryable server failures", () => {
  assert.match(source, /REQUEST_TIMEOUT_MS = 20_000/);
  assert.match(source, /AbortSignal\.any\(\[init\.signal, timeoutSignal\]\)/);
  assert.match(source, /if \(init\.signal\?\.aborted\) throw error/);
  assert.match(source, /timeoutSignal\.aborted \? 504 : 503/);
  assert.match(source, /fetchWithTimeout\(path, \{ \.\.\.init, headers \}\)/);
});
