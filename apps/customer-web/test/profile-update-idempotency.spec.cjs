const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/account/page.tsx"), "utf8");

describe("customer profile update idempotency", () => {
  it("retains one request identity for an unchanged ambiguous retry", () => {
    assert.match(source, /profileAttemptRef/);
    assert.match(source, /"Idempotency-Key": profileAttemptRef\.current\.requestId/);
  });

  it("clears the identity after success or a definitive rejection", () => {
    assert.match(source, /profileAttemptRef\.current = null/);
    assert.match(source, /err instanceof ApiRequestError && err\.status < 500/);
  });
});
