const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/time-clock-gate.tsx"), "utf8");

describe("time clock request idempotency", () => {
  it("starts a fresh clock-in request when the PIN changes", () => {
    assert.match(source, /function changePin/);
    assert.match(source, /clockInAttemptRef\.current = null/);
    assert.match(source, /onChange=\{\(event\) => changePin\(event\.target\.value\)\}/);
  });

  it("reuses the request identity for an unchanged retry", () => {
    assert.match(source, /clockInAttemptRef\.current \?\?= crypto\.randomUUID\(\)/);
    assert.match(source, /requestId: clockInAttemptRef\.current/);
  });
});
