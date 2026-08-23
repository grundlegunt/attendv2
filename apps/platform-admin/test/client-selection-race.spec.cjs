const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/clients/clients-page.tsx"), "utf8");

test("obsolete platform overview requests cannot restore stale state", () => {
  const effect = source.match(/useEffect\(\(\) => \{\s*if \(!session\) return;[\s\S]*?request<Overview>[\s\S]*?\}, \[session\]\);/);
  assert.ok(effect);
  assert.match(effect[0], /let active = true/);
  assert.match(effect[0], /if \(active\) setOverview\(nextOverview\)/);
  assert.match(effect[0], /return \(\) => \{ active = false; \}/);
});

test("switching clients invalidates the previous organization request", () => {
  const effect = source.match(/useEffect\(\(\) => \{[\s\S]*?request<OrganizationDetail>[\s\S]*?\}, \[selectedOrganizationId, session\]\);/);
  assert.ok(effect);
  assert.match(effect[0], /let active = true/);
  assert.match(effect[0], /if \(!active\) return;\s*setOrganization\(nextOrganization\)/);
  assert.match(effect[0], /if \(active\) setOrganizationLoading\(false\)/);
  assert.match(effect[0], /return \(\) => \{ active = false; \}/);
});
