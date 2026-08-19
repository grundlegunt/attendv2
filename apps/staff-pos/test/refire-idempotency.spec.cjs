const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/restaurant-pos.tsx"), "utf8");

describe("fulfillment refire request idempotency", () => {
  it("retains the request identity for an unchanged retry", () => {
    assert.match(source, /const refireAttemptRef = useRef/);
    assert.match(source, /refireAttemptRef\.current\?\.fingerprint !== fingerprint/);
    assert.match(source, /requestId: refireAttemptRef\.current\.requestId/);
  });

  it("resets definitive failures and completed refires", () => {
    assert.match(source, /error instanceof ApiRequestError && error\.status < 500/);
    assert.match(source, /refireAttemptRef\.current = null/);
  });
});
