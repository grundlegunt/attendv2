const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/management-controls.tsx"), "utf8");

test("price-group and admission-type creation use stable retry identities", () => {
  assert.match(source, /priceAttemptRef = useRef/);
  assert.match(source, /ticketTypeAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": priceAttemptRef\.current\.requestId/);
  assert.match(source, /"Idempotency-Key": ticketTypeAttemptRef\.current\.requestId/);
});

test("price-group updates use a stable retry identity", () => {
  assert.match(source, /updatePriceAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": updatePriceAttemptRef\.current\.requestId/);
});
