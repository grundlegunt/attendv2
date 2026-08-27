const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/audience/page.tsx"), "utf8");

describe("website analytics comparison", () => {
  it("shows prior-period changes for headline operator metrics", () => {
    assert.match(source, /comparison: \{ range:/);
    assert.match(source, /countChange\(report\.totals\.Pageview, report\.comparison\.totals\.Pageview\)/);
    assert.match(source, /rateChange\(report\.totals\.checkoutCompletionRatePercent, report\.comparison\.totals\.checkoutCompletionRatePercent\)/);
  });
});
