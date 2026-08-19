const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../app/page.tsx"), "utf8");

describe("fulfillment transition request idempotency", () => {
  it("retains request identity for the same ticket and action", () => {
    assert.match(source, /transitionAttemptRef\.current\?\.fingerprint !== fingerprint/);
    assert.match(source, /JSON\.stringify\(\{ action, requestId: transitionAttemptRef\.current\.requestId \}\)/);
  });

  it("resets completed and definitive attempts", () => {
    const resets = source.match(/transitionAttemptRef\.current = null/g) ?? [];
    assert.equal(resets.length, 2);
    assert.match(source, /reason instanceof ApiRequestError && reason\.status < 500/);
  });
});
