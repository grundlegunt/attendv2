const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/lib/api-client.ts"), "utf8");

test("customer API errors always have a useful fallback message", () => {
  assert.match(source, /statusText\.trim\(\) \|\| `Request failed with status \$\{status\}\.`/);
  assert.match(source, /typeof \(parsed as \{ message\?: unknown \}\)\.message === "string"/);
  assert.match(source, /parseErrorBody\(await res\.text\(\), res\.status, res\.statusText\)/);
});

test("malformed success responses become controlled API errors", () => {
  assert.match(source, /function parseSuccessBody<T>/);
  assert.match(source, /The server returned an invalid response\. Please try again\./);
  assert.match(source, /return parseSuccessBody<T>\(await res\.text\(\), res\.status\)/);
});

test("stalled customer requests time out without losing caller cancellation", () => {
  assert.match(source, /REQUEST_TIMEOUT_MS = 20_000/);
  assert.match(source, /AbortSignal\.any\(\[init\.signal, timeoutSignal\]\)/);
  assert.match(source, /if \(init\?\.signal\?\.aborted\) throw error/);
  assert.match(source, /timeoutSignal\.aborted \? 504 : 503/);
  assert.match(source, /The request timed out\. Please try again\./);
});
