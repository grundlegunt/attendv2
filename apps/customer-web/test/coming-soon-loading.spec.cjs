const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/coming-soon/page.tsx"), "utf8");

describe("coming soon loading", () => {
  it("cancels stale program requests when retrying or changing views", () => {
    assert.match(source, /const controller = new AbortController\(\)/);
    assert.match(source, /signal: controller\.signal/);
    assert.match(source, /reason\.name === "AbortError"/);
    assert.match(source, /return \(\) => controller\.abort\(\)/);
  });
});
