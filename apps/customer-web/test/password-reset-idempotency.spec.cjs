const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/account/page.tsx"), "utf8");

describe("customer password reset idempotency", () => {
  it("retains one request identity for an unchanged ambiguous retry", () => {
    assert.match(source, /passwordResetAttemptRef/);
    assert.match(source, /"Idempotency-Key": passwordResetAttemptRef\.current\.requestId/);
  });

  it("clears the identity after success or a definitive rejection", () => {
    assert.match(source, /passwordResetAttemptRef\.current = null/);
    assert.match(source, /err instanceof ApiRequestError && err\.status < 500/);
  });
});
