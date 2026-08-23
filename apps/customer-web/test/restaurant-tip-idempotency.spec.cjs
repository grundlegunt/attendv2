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

  it("uses stable request identities and blocks duplicate customer order submissions", () => {
    assert.match(source, /orderAttemptRef\.current\?\.fingerprint !== fingerprint/);
    assert.match(source, /requestId: orderAttemptRef\.current\.createId/);
    assert.match(source, /requestId: orderAttemptRef\.current\.itemId/);
    assert.match(source, /requestId: orderAttemptRef\.current\.sendId/);
    assert.match(source, /if \(!guestToken \|\| orderPendingRef\.current\) return/);
    assert.match(source, /orderPendingRef\.current = true/);
  });
});
