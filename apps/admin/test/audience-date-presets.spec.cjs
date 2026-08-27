const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/audience/page.tsx"), "utf8");

describe("website analytics date presets", () => {
  it("loads standard ranges anchored to cinema-local today", () => {
    assert.match(source, /\[\[1, "Today"\], \[7, "7 days"\], \[30, "30 days"\], \[90, "90 days"\]\]/);
    assert.match(source, /localDateInputValue\(new Date\(\), timeZone\)/);
    assert.match(source, /void load\(nextFrom, today\)/);
  });
});
