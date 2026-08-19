const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/ticket-service.tsx"), "utf8");

describe("ticket exchange request idempotency", () => {
  it("starts a fresh exchange request when the reason changes", () => {
    assert.match(source, /function changeExchangeReason/);
    assert.match(source, /exchangeRequestIdRef\.current = crypto\.randomUUID\(\)/);
    assert.match(source, /onChange=\{\(event\) => changeExchangeReason\(event\.target\.value\)\}/);
  });

  it("keeps the replacement-seat hold while only the reason changes", () => {
    const handler = source.match(/function changeExchangeReason[\s\S]*?\n  \}/)?.[0] ?? "";
    assert.doesNotMatch(handler, /releaseHold/);
    assert.doesNotMatch(handler, /exchangeHolderKeyRef/);
    assert.doesNotMatch(handler, /setExchangeSeatId/);
  });
});
