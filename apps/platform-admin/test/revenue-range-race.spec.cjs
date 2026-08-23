const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const dashboard = readFileSync(resolve(__dirname, "../app/page.tsx"), "utf8");
const clients = readFileSync(resolve(__dirname, "../app/clients/clients-page.tsx"), "utf8");

test("the platform dashboard ignores an older revenue-range response", () => {
  assert.match(dashboard, /const revenueRequestRef = useRef\(0\)/);
  assert.match(dashboard, /const requestId = \+\+revenueRequestRef\.current/);
  assert.match(dashboard, /requestId === revenueRequestRef\.current\) setRevenue\(nextRevenue\)/);
  assert.match(dashboard, /requestId === revenueRequestRef\.current\) setRevenueLoading\(false\)/);
});

test("client revenue requests stop updating state after their range changes", () => {
  const effect = clients.match(/useEffect\(\(\) => \{[\s\S]*?revenuePath\(selectedOrganizationId, revenueDays\)[\s\S]*?\}, \[selectedOrganizationId, session, revenueDays\]\);/);
  assert.ok(effect);
  assert.match(effect[0], /let active = true/);
  assert.match(effect[0], /if \(active\) setRevenue\(nextRevenue\)/);
  assert.match(effect[0], /return \(\) => \{ active = false; \}/);
});
