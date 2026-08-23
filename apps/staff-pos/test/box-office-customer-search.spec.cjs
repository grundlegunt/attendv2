const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/box-office-pos.tsx"), "utf8");

test("box-office customer lookup blocks duplicate and sale-overlapping searches", () => {
  assert.match(source, /if \(busyRef\.current \|\| customerSearchPendingRef\.current\) return/);
  assert.match(source, /customerSearchPendingRef\.current = true/);
  assert.match(source, /requestId === customerSearchRequestRef\.current\) \{ customerSearchPendingRef\.current = false/);
  assert.match(source, /customerSearchRequestRef\.current \+= 1;\s*customerSearchPendingRef\.current = false/);
});

test("box-office customer results disclose membership details and handle phone-only records", () => {
  assert.match(source, /customer\.membership\.tier/);
  assert.match(source, /customer\.membership\.status\.toLowerCase\(\)/);
  assert.match(source, /customer\.membership\.membershipNumber/);
  assert.match(source, /customer\.name \|\| customer\.email \|\| customer\.phone/);
});

test("box-office search invites membership-number lookup", () => {
  assert.match(source, /Find by name, email, phone, or membership number/);
  assert.match(source, /customer\.membership\.membershipNumber/);
});

test("selected lookup customers attach to checkout by id without requiring email", () => {
  assert.match(source, /setSelectedCustomerId\(customer\.id\)/);
  assert.match(source, /customerId: selectedCustomerId \?\? undefined/);
  assert.doesNotMatch(source, /disabled=\{busy \|\| !customer\.email\}/);
  assert.match(source, /setCustomerEmail\(customer\.email \?\? ""\)/);
});
