const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const page = readFileSync(join(__dirname, "../app/distributors/page.tsx"), "utf8");

test("Master distributor reports support custom inclusive date ranges", () => {
  assert.match(page, /value === "custom" \? "Custom"/);
  assert.match(page, /range === "custom" && <div className="custom-range">/);
  assert.match(page, /`\?from=\$\{encodeURIComponent\(`\$\{customFrom\}T00:00:00\.000Z`\)\}&to=\$\{encodeURIComponent\(`\$\{customTo\}T23:59:59\.999Z`\)\}`/);
  assert.match(page, /\[session, range, customFrom, customTo\]/);
  assert.match(page, /rangeQuery\(range, customFrom, customTo\)/);
});
