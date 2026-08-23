const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../app/components/analytics-consent.tsx"), "utf8");

test("optional analytics starts disabled and requires an explicit choice", () => {
  assert.match(source, /applyChoice\("essential"\)/);
  assert.match(source, /onClick=\{\(\) => save\("analytics"\)\}/);
  assert.doesNotMatch(source, /save\("analytics"\).*useEffect/s);
});

test("consent is versioned, reversible, and separate from marketing", () => {
  assert.match(source, /attend\.analytics-consent\.v1/);
  assert.match(source, /Privacy choices/);
  assert.match(source, /href="\/privacy"/);
});
