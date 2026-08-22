const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/management-controls.tsx"), "utf8");

test("employee creation retains a stable retry identity", () => {
  assert.match(source, /employeeAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": employeeAttemptRef\.current\.requestId/);
});

test("employee access updates retain a stable retry identity", () => {
  assert.match(source, /updateEmployeeAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": updateEmployeeAttemptRef\.current\.requestId/);
  assert.match(source, /submitEmployeeUpdate\(target\.id, \{ active:/);
  assert.match(source, /submitEmployeeUpdate\(target\.id, \{ roleIds \}\)/);
});

test("credential resets retain a stable retry identity", () => {
  assert.match(source, /credentialResetAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": credentialResetAttemptRef\.current\.requestId/);
});

test("employee mutations share an immediate action lock", () => {
  assert.match(source, /employeeActionRef = useRef\(false\)/);
  assert.equal(source.match(/if \(employeeActionRef\.current(?: \|\| roleActionRef\.current)?\) return/g)?.length, 3);
  assert.equal(source.match(/employeeActionRef\.current = true;/g)?.length, 3);
  assert.equal(source.match(/employeeActionRef\.current = false;/g)?.length, 3);
  assert.match(source, /setEmployeeAction\(\{ kind: "create" \}\)/);
  assert.match(source, /setEmployeeAction\(\{ kind: "update", id: targetId \}\)/);
  assert.match(source, /setEmployeeAction\(\{ kind: "credentials", id: target\.id \}\)/);
});
