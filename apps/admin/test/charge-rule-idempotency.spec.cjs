const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/management-controls.tsx"), "utf8");

test("tax and service-charge creation retain stable retry identities", () => {
  assert.match(source, /taxAttemptRef = useRef/);
  assert.match(source, /chargeAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": taxAttemptRef\.current!\.requestIds\[body\.appliesTo\]/);
  assert.match(source, /"Idempotency-Key": chargeAttemptRef\.current\.requestId/);
});

test("one tax form can create idempotent rules for multiple categories", () => {
  assert.match(source, /function setTaxCategory/);
  assert.match(source, /tax\.appliesTo\.map\(\(appliesTo\)/);
  assert.match(source, /await Promise\.all/);
  assert.match(source, /Choose at least one tax category\./);
  assert.match(source, /category === "ALL"/);
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

test("tax and service-charge rules can be permanently deleted with stable retry identities", () => {
  assert.match(source, /deleteTaxAttemptRef = useRef/);
  assert.match(source, /deleteChargeAttemptRef = useRef/);
  assert.match(source, /method: "DELETE"/);
  assert.match(source, /Permanently delete \$\{name\}/);
  assert.match(source, /: "Delete permanently"/);
});

test("tax and service-charge mutations share an immediate action lock", () => {
  assert.match(source, /checkoutRuleActionRef = useRef\(false\)/);
  assert.equal(source.match(/if \(checkoutRuleActionRef\.current\) return;/g)?.length, 4);
  assert.equal(source.match(/checkoutRuleActionRef\.current = true;/g)?.length, 4);
  assert.equal(source.match(/checkoutRuleActionRef\.current = false;/g)?.length, 4);
  assert.match(source, /setCheckoutRuleAction\(\{ kind: "create-tax" \}\)/);
  assert.match(source, /setCheckoutRuleAction\(\{ kind: "create-service" \}\)/);
  assert.match(source, /setCheckoutRuleAction\(\{ kind: "update", id, field: Object\.keys\(changes\)\[0\] \}\)/);
  assert.match(source, /setCheckoutRuleAction\(\{ kind: "delete", id \}\)/);
});

test("tax and service-charge editors use a full-width responsive layout", () => {
  const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");
  assert.match(source, /admin-grid pricing-settings-grid/);
  assert.equal(source.match(/panel checkout-rules-panel/g)?.length, 2);
  assert.match(css, /\.pricing-settings-grid \.checkout-rules-panel \{ grid-column: 1 \/ -1; \}/);
  assert.match(css, /\.checkout-rule-editor \{ display: grid;/);
});
