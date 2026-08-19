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
});
