const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");
const source = readFileSync(resolve(__dirname, "../app/platform-nav.tsx"), "utf8");

test("shared Master navigation includes every operating workspace", () => {
  for (const path of ["/clients", "/benchmarks", "/films", "/distributors", "/analytics", "/onboarding", "/payments", "/operations", "/content", "/branding", "/team", "/audit", "/diagnostics"]) assert.match(source, new RegExp(path));
});

test("shared Master navigation derives active state and protects Team visibility", () => {
  assert.match(source, /usePathname/);
  assert.match(source, /pathname\.startsWith/);
  assert.match(source, /role === "OWNER"/);
});
