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
  assert.match(source, /bulkPriceAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": updatePriceAttemptRef\.current\.requestId/);
  assert.match(source, /"Idempotency-Key": bulkPriceAttemptRef\.current\.requestId/);
});

test("admission-type updates use a stable retry identity", () => {
  assert.match(source, /updateTicketTypeAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": updateTicketTypeAttemptRef\.current\.requestId/);
});

test("ticket pricing mutations share an immediate action lock", () => {
  assert.match(source, /ticketPricingActionRef = useRef\(false\)/);
  assert.equal(source.match(/if \(ticketPricingActionRef\.current\) return;/g)?.length, 6);
  assert.equal(source.match(/ticketPricingActionRef\.current = true;/g)?.length, 6);
  assert.equal(source.match(/ticketPricingActionRef\.current = false;/g)?.length, 6);
  assert.match(source, /setTicketPricingAction\(\{ kind: "create-price" \}\)/);
  assert.match(source, /setTicketPricingAction\(\{ kind: "create-type" \}\)/);
  assert.match(source, /setTicketPricingAction\(\{ kind: "save-price", id: tier\.id \}\)/);
  assert.match(source, /setTicketPricingAction\(\{ kind: "toggle-price", id: tier\.id \}\)/);
  assert.match(source, /setTicketPricingAction\(\{ kind: "bulk-price" \}\)/);
  assert.match(source, /setTicketPricingAction\(\{ kind: "update-type", id: ticketType\.id \}\)/);
});
