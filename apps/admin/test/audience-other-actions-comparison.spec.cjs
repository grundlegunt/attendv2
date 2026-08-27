const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/audience/page.tsx"), "utf8");

describe("other website conversion comparisons", () => {
  it("compares gift cards, memberships, donations, and private-event inquiries", () => {
    assert.match(source, /report\.comparison\.totals\.giftCardCompletionRatePercent/);
    assert.match(source, /report\.comparison\.totals\.membershipCompletionRatePercent/);
    assert.match(source, /report\.comparison\.totals\.donationCompletionRatePercent/);
    assert.match(source, /report\.comparison\.totals\["Private Event Inquiry Submitted"\]/);
  });
});
