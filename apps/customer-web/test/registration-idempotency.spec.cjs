const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/account/page.tsx"), "utf8");

describe("customer registration idempotency", () => {
  it("retains one request identity for an unchanged ambiguous retry", () => {
    assert.match(source, /registrationAttemptRef/);
    assert.match(source, /"Idempotency-Key": registrationAttemptRef\.current!\.requestId/);
  });

  it("clears the identity after success or a definitive rejection", () => {
    assert.match(source, /registrationAttemptRef\.current = null/);
    assert.match(source, /mode === "register" && err instanceof ApiRequestError && err\.status < 500/);
  });
});
