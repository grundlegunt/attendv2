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

test("role deletion retains a stable retry identity", () => {
  assert.match(source, /deleteRoleAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": deleteRoleAttemptRef\.current\.requestId/);
});

test("role mutations share an immediate lock with employee access changes", () => {
  assert.match(source, /roleActionRef = useRef\(false\)/);
  assert.equal(source.match(/if \(roleActionRef\.current \|\| employeeActionRef\.current\) return;/g)?.length, 4);
  assert.equal(source.match(/roleActionRef\.current = true;/g)?.length, 4);
  assert.equal(source.match(/roleActionRef\.current = false;/g)?.length, 4);
  assert.match(source, /if \(employeeActionRef\.current \|\| roleActionRef\.current\) return false;/);
  assert.match(source, /setRoleAction\("create"\)/);
  assert.match(source, /setRoleAction\("rename"\)/);
  assert.match(source, /setRoleAction\("permissions"\)/);
  assert.match(source, /setRoleAction\("delete"\)/);
});
