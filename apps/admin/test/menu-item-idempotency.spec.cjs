const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/menu-manager.tsx"), "utf8");

test("menu item creation retains a stable retry identity", () => {
  assert.match(source, /itemAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": itemAttemptRef\.current\.requestId/);
  assert.match(source, /error\.status < 500/);
});
