const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../app/management-controls.tsx"), "utf8");

test("role creation retains a stable retry identity", () => {
  assert.match(source, /roleAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": roleAttemptRef\.current\.requestId/);
});
