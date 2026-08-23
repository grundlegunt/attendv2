const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/management-dashboard.tsx"), "utf8");

test("management refreshes ignore responses from superseded requests", () => {
  assert.match(source, /const refreshRequestRef = useRef\(0\)/);
  assert.match(source, /const requestId = \+\+refreshRequestRef\.current/);
  assert.match(source, /if \(requestId !== refreshRequestRef\.current\) return/);
  assert.match(source, /requestId === refreshRequestRef\.current\) setError/);
  assert.match(source, /return \(\) => \{ refreshRequestRef\.current \+= 1; \}/);
});
