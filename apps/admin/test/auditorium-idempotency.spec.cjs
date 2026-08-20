const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/auditorium-builder.tsx"), "utf8");

test("auditorium creation retains a stable retry identity", () => {
  assert.match(source, /createAuditoriumAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": createAuditoriumAttemptRef\.current\.requestId/);
  assert.match(source, /reason instanceof ApiRequestError && reason\.status < 500/);
});

test("auditorium layout saves retain a stable retry identity and version", () => {
  assert.match(source, /updateAuditoriumAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": updateAuditoriumAttemptRef\.current\.requestId/);
  assert.match(source, /"If-Match": String\(editingVersion\)/);
});

test("auditorium duplication retains a stable retry identity", () => {
  assert.match(source, /duplicateAuditoriumAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": duplicateAuditoriumAttemptRef\.current\.requestId/);
});

test("auditorium deactivation retains a stable retry identity", () => {
  assert.match(source, /deactivateAuditoriumAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": deactivateAuditoriumAttemptRef\.current\.requestId/);
});
