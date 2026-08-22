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

test("tax rules expose editable name, category, and percentage fields", () => {
  assert.match(source, /function saveTaxRule/);
  assert.match(source, /const name = taxNameDrafts\[rule\.id\]/);
  assert.match(source, /appliesTo: taxCategoryDrafts\[rule\.id\]/);
  assert.match(source, /percentageToPermille\(taxRateDrafts\[rule\.id\]/);
  assert.match(source, /: "Save changes"/);
});

test("service-charge updates retain a stable retry identity", () => {
  assert.match(source, /updateChargeAttemptRef = useRef/);
  assert.match(source, /updateChargeAttemptRef\.current!\.requestId/);
});

test("tax and service-charge mutations share an immediate action lock", () => {
  assert.match(source, /checkoutRuleActionRef = useRef\(false\)/);
  assert.equal(source.match(/if \(checkoutRuleActionRef\.current\) return;/g)?.length, 3);
  assert.equal(source.match(/checkoutRuleActionRef\.current = true;/g)?.length, 3);
  assert.equal(source.match(/checkoutRuleActionRef\.current = false;/g)?.length, 3);
  assert.match(source, /setCheckoutRuleAction\(\{ kind: "create-tax" \}\)/);
  assert.match(source, /setCheckoutRuleAction\(\{ kind: "create-service" \}\)/);
  assert.match(source, /setCheckoutRuleAction\(\{ kind: "update", id, field: Object\.keys\(changes\)\[0\] \}\)/);
});
