const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/branding-editor.tsx"), "utf8");
const dashboardSource = readFileSync(resolve(__dirname, "../app/management-dashboard.tsx"), "utf8");

test("branding and website-copy publishers lock before React rerenders", () => {
  assert.equal(source.match(/const savingRef = useRef\(false\)/g)?.length, 2);
  assert.equal(source.match(/if \(savingRef\.current \|\| disabled\) return;\s*savingRef\.current = true/g)?.length, 2);
  assert.equal(source.match(/finally \{ savingRef\.current = false; setSaving\(false\); \}/g)?.length, 2);
});

test("live-site publishers share one immediate action lock", () => {
  assert.match(dashboardSource, /const publicSiteActionRef = useRef\(false\)/);
  assert.equal(dashboardSource.match(/if \(publicSiteActionRef\.current\) return;\s*publicSiteActionRef\.current = true/g)?.length, 3);
  assert.equal(dashboardSource.match(/publicSiteActionRef\.current = false;\s*setPublicSiteAction\(null\)/g)?.length, 3);
  assert.match(dashboardSource, /disabled=\{publicSiteAction !== null\}/);
  assert.match(source, /disabled=\{saving \|\| disabled\}/);
});
