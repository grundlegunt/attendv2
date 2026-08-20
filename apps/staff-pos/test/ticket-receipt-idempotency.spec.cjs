const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/ticket-service.tsx"), "utf8");

describe("ticket receipt resend idempotency", () => {
  it("keeps one request id while a failed resend is retried", () => {
    assert.match(source, /receiptAttemptRef/);
    assert.match(source, /requestId: crypto\.randomUUID\(\)/);
    assert.match(source, /JSON\.stringify\(\{ requestId, email \}\)/);
  });

  it("starts a fresh request after success or an email change", () => {
    assert.match(source, /receiptDelivery === "SENT"\) delete receiptAttemptRef\.current\[order\.id\]/);
    assert.match(source, /delete receiptAttemptRef\.current\[order\.id\]; setReceiptEmails/);
  });
});
