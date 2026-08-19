const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../app/restaurant-pos.tsx"), "utf8");

describe("restaurant remove-item request idempotency", () => {
  it("retains a request id for an unchanged ambiguous retry", () => {
    assert.match(source, /removeItemAttemptRef\.current\?\.fingerprint !== fingerprint/);
    assert.match(source, /requestId: removeItemAttemptRef\.current\.requestId/);
    assert.match(source, /error instanceof ApiRequestError && error\.status < 500/);
  });
});
