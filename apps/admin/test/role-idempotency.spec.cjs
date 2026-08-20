const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../app/management-controls.tsx"), "utf8");

test("role creation retains a stable retry identity", () => {
  assert.match(source, /roleAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": roleAttemptRef\.current\.requestId/);
});

test("role renaming retains a stable retry identity", () => {
  assert.match(source, /renameRoleAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": renameRoleAttemptRef\.current\.requestId/);
});

test("role permission changes retain a stable retry identity", () => {
  assert.match(source, /rolePermissionsAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": rolePermissionsAttemptRef\.current\.requestId/);
});
