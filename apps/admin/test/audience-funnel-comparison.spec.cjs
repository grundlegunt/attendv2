const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/audience/page.tsx"), "utf8");

describe("checkout funnel comparisons", () => {
  it("compares the volume and conversion rate at every ticket funnel step", () => {
    assert.match(source, /funnelChange\(report\.totals\["Seat Selection Continued"\]/);
    assert.match(source, /report\.comparison\.totals\.seatToCheckoutRatePercent/);
    assert.match(source, /report\.comparison\.totals\.paymentFormReadyRatePercent/);
    assert.match(source, /report\.comparison\.totals\.paymentCompletionRatePercent/);
  });
});
