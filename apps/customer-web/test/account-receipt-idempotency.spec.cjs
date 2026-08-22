const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/account/page.tsx"), "utf8");

describe("customer ticket receipt resend idempotency", () => {
  it("retains one request key for an ambiguous resend retry", () => {
    assert.match(source, /receiptAttemptRef/);
    assert.match(source, /receiptAttemptRef\.current\[order\.id\] \?\? crypto\.randomUUID\(\)/);
    assert.match(source, /"Idempotency-Key": requestId/);
  });

  it("starts a fresh request after a successful delivery", () => {
    assert.match(source, /receiptDelivery === "SENT"\) delete receiptAttemptRef\.current\[order\.id\]/);
  });

  it("allows only one account receipt resend at a time", () => {
    assert.match(source, /if \(receiptPendingRef\.current\) return/);
    assert.match(source, /receiptPendingRef\.current = order\.id/);
    assert.match(source, /if \(receiptPendingRef\.current === order\.id\)/);
    assert.match(source, /receiptPendingRef\.current = null/);
  });
});
