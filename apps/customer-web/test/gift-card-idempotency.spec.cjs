const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/gift-cards/page.tsx"), "utf8");

describe("gift card purchase idempotency", () => {
  it("starts a new request identity when purchase details change", () => {
    assert.match(source, /function changePurchaseDetail/);
    assert.match(source, /purchaseKey\.current = null/);
    for (const setter of ["setAmount", "setBuyerEmail", "setRecipientName", "setRecipientEmail", "setMessage"]) {
      assert.match(source, new RegExp(`changePurchaseDetail\\(${setter},`));
    }
  });

  it("reuses one request identity while unchanged purchase details retry", () => {
    assert.match(source, /if \(!purchaseKey\.current\) purchaseKey\.current = crypto\.randomUUID\(\)/);
    assert.match(source, /"Idempotency-Key": purchaseKey\.current/);
  });

  it("waits for an in-flight payment instead of confirming it again", () => {
    assert.match(source, /while \(active && resumed\.payment\.status === "PROCESSING"\)/);
    assert.match(source, /window\.setTimeout\(resolve, 2_000\)/);
    assert.match(source, /if \(!active\) return/);
  });

  it("blocks duplicate create and payment actions before React rerenders", () => {
    assert.match(source, /if \(!config \|\| purchaseActionPendingRef\.current\) return/);
    assert.match(source, /payment\.publishableKey \|\| purchaseActionPendingRef\.current\) return/);
    assert.equal((source.match(/purchaseActionPendingRef\.current = true/g) ?? []).length, 2);
    assert.equal((source.match(/purchaseActionPendingRef\.current = false/g) ?? []).length, 2);
  });
});
