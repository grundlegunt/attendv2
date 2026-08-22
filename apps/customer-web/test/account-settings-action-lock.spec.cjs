const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/account/page.tsx"), "utf8");

test("customer password and profile updates block duplicate submissions", () => {
  for (const ref of ["passwordPendingRef", "profilePendingRef"]) {
    assert.match(source, new RegExp(`if \\(${ref}\\.current\\) return`));
    assert.match(source, new RegExp(`${ref}\\.current = true`));
    assert.match(source, new RegExp(`${ref}\\.current = false`));
  }
});

test("email change request and confirmation share an immediate lock", () => {
  assert.equal((source.match(/if \(emailChangePendingRef\.current\) return/g) ?? []).length, 2);
  assert.equal((source.match(/emailChangePendingRef\.current = true/g) ?? []).length, 2);
  assert.equal((source.match(/emailChangePendingRef\.current = false/g) ?? []).length, 2);
});
