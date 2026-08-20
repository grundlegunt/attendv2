const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/management-controls.tsx"), "utf8");

test("tax and service-charge creation retain stable retry identities", () => {
  assert.match(source, /taxAttemptRef = useRef/);
  assert.match(source, /chargeAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": taxAttemptRef\.current\.requestId/);
  assert.match(source, /"Idempotency-Key": chargeAttemptRef\.current\.requestId/);
});

test("tax-rule updates retain a stable retry identity", () => {
  assert.match(source, /updateTaxAttemptRef = useRef/);
  assert.match(source, /updateTaxAttemptRef\.current!\.requestId/);
});

test("service-charge updates retain a stable retry identity", () => {
  assert.match(source, /updateChargeAttemptRef = useRef/);
  assert.match(source, /updateChargeAttemptRef\.current!\.requestId/);
});
