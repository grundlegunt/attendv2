const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "../app/components/live-restaurant-tab.tsx"),
  "utf8",
);

describe("restaurant tip request idempotency", () => {
  it("retains the request identity for an unchanged ambiguous retry", () => {
    assert.match(source, /tipAttemptRef\.current\?\.fingerprint !== tipFingerprint/);
    assert.match(source, /requestId: tipAttemptRef\.current\.requestId/);
    assert.match(source, /error instanceof ApiRequestError && error\.status < 500/);
  });
});
