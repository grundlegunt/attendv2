const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const pages = [
  "about/page.tsx",
  "directions/page.tsx",
  "film-series/page.tsx",
  "film-series/[id]/page.tsx",
  "components/customer-branding.tsx",
];

for (const page of pages) {
  test(`${page} cancels public data loading on retry or navigation`, () => {
    const source = readFileSync(join(__dirname, "../app", page), "utf8");
    assert.match(source, /const controller = new AbortController\(\)/);
    assert.match(source, /signal: controller\.signal/);
    assert.match(source, /return \(\) => controller\.abort\(\)/);
  });
}
