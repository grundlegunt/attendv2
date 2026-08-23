const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/expenses/page.tsx"), "utf8");

test("expense reports ignore responses from superseded date ranges", () => {
  assert.match(source, /const loadRequestRef = useRef\(0\)/);
  assert.match(source, /const requestId = \+\+loadRequestRef\.current/);
  assert.match(source, /requestId === loadRequestRef\.current\) setReport\(nextReport\)/);
  assert.match(source, /requestId === loadRequestRef\.current\) setLoading\(false\)/);
  assert.match(source, /return \(\) => \{ loadRequestRef\.current \+= 1; \}/);
});
