const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const Module = require("node:module");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");
const ts = require("typescript");

const helperPath = resolve(__dirname, "../app/lib/checkout-hold.ts");
const helperSource = readFileSync(helperPath, "utf8");
const compiled = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: helperPath,
});
const helperModule = new Module(helperPath, module);
helperModule.filename = helperPath;
helperModule.paths = module.paths;
helperModule._compile(compiled.outputText, helperPath);
const { isCheckoutHoldExpired } = helperModule.exports;

const checkoutSource = readFileSync(resolve(__dirname, "../app/components/ticket-checkout.tsx"), "utf8");

describe("checkout hold expiration", () => {
  it("treats zero, negative, and invalid countdowns as expired", () => {
    assert.equal(isCheckoutHoldExpired(1), false);
    assert.equal(isCheckoutHoldExpired(0), true);
    assert.equal(isCheckoutHoldExpired(-1), true);
    assert.equal(isCheckoutHoldExpired(Number.NaN), true);
  });

  it("guards card and express checkout before confirming payment", () => {
    assert.match(checkoutSource, /pendingRef\.current \|\| isCheckoutHoldExpired\(holdRemainingSecondsRef\.current\)/);
    assert.match(checkoutSource, /!checkout \|\| pendingRef\.current \|\| holdExpired/);
    assert.match(checkoutSource, /disabled=\{pending \|\| holdExpired \|\|/);
    assert.match(checkoutSource, /Payment is now disabled and no new payment will be submitted\./);
  });

  it("destroys mounted payment controls and explains confirmed-payment recovery", () => {
    assert.match(checkoutSource, /!mountableElements \|\| confirmation \|\| holdExpired/);
    assert.match(checkoutSource, /\[confirmation, holdExpired, mountableElements\]/);
    assert.match(checkoutSource, /it will be refunded if tickets cannot be issued\./);
  });

  it("waits for an in-flight resumed payment instead of confirming it again", () => {
    assert.match(checkoutSource, /while \(active && resumed\.payment\?\.status === "PROCESSING"\)/);
    assert.match(checkoutSource, /window\.setTimeout\(resolve, 2_000\)/);
    assert.match(checkoutSource, /paymentConfirmedRef\.current = true/);
  });

  it("keeps ticket-type and ZIP-code controls out of customer checkout", () => {
    assert.doesNotMatch(checkoutSource, /<h3>Ticket types<\/h3>/);
    assert.doesNotMatch(checkoutSource, /ZIP code \(optional\)/);
    assert.doesNotMatch(checkoutSource, /zipCode:/);
  });
});
