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
