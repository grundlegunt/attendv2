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
