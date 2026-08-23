const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

for (const [name, path, setter] of [
  ["Content Studio", "../app/content/page.tsx", "setOrganizations"],
  ["Brand Studio", "../app/branding/page.tsx", "setOrganizations"],
  ["onboarding", "../app/onboarding/page.tsx", "setOverview"],
]) {
  test(`${name} ignores results from an obsolete platform session`, () => {
    const source = readFileSync(resolve(__dirname, path), "utf8");
    assert.match(source, /let active = true/);
    assert.match(source, new RegExp(`if \\(active\\) ${setter}\\(`));
    assert.match(source, /return \(\) => \{ active = false; \}/);
  });
}
