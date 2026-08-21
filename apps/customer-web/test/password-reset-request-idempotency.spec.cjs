const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/account/page.tsx"), "utf8");

describe("customer password reset request idempotency", () => {
  it("retains one request identity for an unchanged ambiguous retry", () => {
    assert.match(source, /passwordResetRequestAttemptRef/);
    assert.match(source, /"Idempotency-Key": passwordResetRequestAttemptRef\.current\.requestId/);
  });

  it("clears the identity after acceptance or a definitive rejection", () => {
    assert.match(source, /passwordResetRequestAttemptRef\.current = null/);
    assert.match(source, /err instanceof ApiRequestError && err\.status < 500/);
  });
});
