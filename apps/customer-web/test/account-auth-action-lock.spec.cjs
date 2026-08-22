const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/account/page.tsx"), "utf8");

test("customer authentication forms share an immediate submission lock", () => {
  assert.equal((source.match(/if \(loadingRef\.current\) return/g) ?? []).length, 3);
  assert.equal((source.match(/loadingRef\.current = true/g) ?? []).length, 3);
  assert.equal((source.match(/loadingRef\.current = false/g) ?? []).length, 3);
});

test("password mismatch validation does not leave the action locked", () => {
  const confirmation = source.match(
    /async function confirmPasswordReset[\s\S]*?async function signOut/,
  );
  assert.ok(confirmation);
  assert.match(confirmation[0], /if \(password !== passwordConfirmation\)[\s\S]*?return;\s*}\s*loadingRef\.current = true/);
});
