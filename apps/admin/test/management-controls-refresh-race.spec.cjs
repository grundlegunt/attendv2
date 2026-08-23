const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/management-controls.tsx"), "utf8");

test("management controls ignore superseded section refreshes", () => {
  assert.match(source, /const refreshRequestRef = useRef\(0\)/);
  assert.match(source, /const requestId = \+\+refreshRequestRef\.current/);
  assert.match(source, /if \(requestId !== refreshRequestRef\.current\) return;\s+setSettings/);
  assert.match(source, /catch \(reason\) \{\s+if \(requestId !== refreshRequestRef\.current\) return/);
  assert.match(source, /return \(\) => \{ refreshRequestRef\.current \+= 1; \}/);
});
