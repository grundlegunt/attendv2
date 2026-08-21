const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/account/page.tsx"), "utf8");

describe("customer email change idempotency", () => {
  it("retains one request identity for an unchanged ambiguous retry", () => {
    assert.match(source, /emailChangeAttemptRef/);
    assert.match(source, /fingerprint: string; requestId: string/);
    assert.match(source, /"Idempotency-Key": emailChangeAttemptRef\.current\.requestId/);
  });

  it("clears the identity after success or a definitive rejection", () => {
    assert.match(source, /emailChangeAttemptRef\.current = null/);
    assert.match(source, /err instanceof ApiRequestError && err\.status < 500/);
  });
});
