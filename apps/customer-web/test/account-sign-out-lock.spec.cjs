const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/account/page.tsx"), "utf8");

test("customer sign-out blocks concurrent requests immediately", () => {
  assert.match(source, /if \(!session \|\| signOutPendingRef\.current\) return/);
  assert.match(source, /signOutPendingRef\.current = true/);
  assert.match(source, /finally \{\s*signOutPendingRef\.current = false/);
  assert.match(source, /disabled=\{signOutPending\}/);
  assert.match(source, /signOutPending \? "Signing out…" : "Sign out"/);
});
