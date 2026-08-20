const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/gift-cards/page.tsx"), "utf8");

describe("gift card admin resilience", () => {
  it("reports loading failures instead of presenting a false empty ledger", () => {
    assert.match(source, /Gift cards could not be loaded\./);
    assert.match(source, /loading \? <p>Loading gift cards/);
    assert.match(source, /!error && cards\.length === 0/);
    assert.match(source, /controller\.abort\(\)/);
  });

  it("validates amounts and prevents duplicate submissions", () => {
    assert.match(source, /Number\.isFinite\(amountCents\)/);
    assert.match(source, /amountCents < 500 \|\| amountCents > 100_000/);
    assert.match(source, /disabled=\{saving\}/);
    assert.match(source, /await load\(\)/);
  });

  it("uses a fresh request identity when issuance details change", () => {
    assert.match(source, /function changeIssuanceDetail/);
    assert.match(source, /issuanceKey\.current = crypto\.randomUUID\(\)/);
    for (const setter of ["setAmount", "setRecipientName", "setRecipientEmail"]) {
      assert.match(source, new RegExp(`changeIssuanceDetail\\(${setter},`));
    }
  });

  it("retains a stable retry identity for status updates", () => {
    assert.match(source, /statusAttemptRef = useRef/);
    assert.match(source, /"Idempotency-Key": statusAttemptRef\.current\.requestId/);
  });
});
