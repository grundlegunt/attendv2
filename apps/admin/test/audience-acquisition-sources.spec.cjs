const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/audience/page.tsx"), "utf8");

describe("website acquisition reporting", () => {
  it("shows aggregate source categories and explains the privacy boundary", () => {
    assert.match(source, /How customers arrived/);
    assert.match(source, /Raw referral URLs and campaign names are not stored/);
    assert.match(source, /report\.sources\.map/);
  });
});
