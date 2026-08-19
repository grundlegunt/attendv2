const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/showtimes/page.tsx"), "utf8");

describe("showtimes loading", () => {
  it("cancels stale program requests when retrying or leaving the page", () => {
    assert.match(source, /const controller = new AbortController\(\)/);
    assert.match(source, /signal: controller\.signal/);
    assert.match(source, /err\.name === "AbortError"/);
    assert.match(source, /return \(\) => controller\.abort\(\)/);
  });
});
