const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/audience/page.tsx"), "utf8");

describe("website analytics dates", () => {
  it("sends stable calendar-day keys instead of timezone-shifted instants", () => {
    assert.match(source, /new URLSearchParams\(\{ from, to: through \}\)/);
    assert.doesNotMatch(source, /inclusiveReportRange/);
  });
});
