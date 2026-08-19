const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../app/restaurant-pos.tsx"), "utf8");

describe("restaurant send-order request idempotency", () => {
  it("retains the request identity for an unchanged retry", () => {
    assert.match(source, /sendOrderAttemptRef\.current\?\.fingerprint !== fingerprint/);
    assert.match(source, /body: JSON\.stringify\(\{ requestId: sendOrderAttemptRef\.current\.requestId \}\)/);
  });

  it("resets definitive failures and completed sends", () => {
    const resets = source.match(/sendOrderAttemptRef\.current = null/g) ?? [];
    assert.equal(resets.length, 2);
    assert.match(source, /error instanceof ApiRequestError && error\.status < 500/);
  });
});
