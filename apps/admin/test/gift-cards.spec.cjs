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
    assert.match(source, /if \(actionPendingRef\.current\) return;\s*actionPendingRef\.current = true/);
    assert.match(source, /disabled=\{actionPending\}/);
    assert.match(source, /await load\(\)/);
  });

  it("serializes issuance and status changes with one immediate lock", () => {
    assert.match(source, /const actionPendingRef = useRef\(false\)/);
    assert.match(source, /async function updateStatus[\s\S]*?if \(actionPendingRef\.current\) return;[\s\S]*?setPendingStatusCardId\(card\.id\)/);
    assert.match(source, /setPendingStatusCardId\(null\)/);
    assert.match(source, /pendingStatusCardId === card\.id \? "Updating…"/);
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
