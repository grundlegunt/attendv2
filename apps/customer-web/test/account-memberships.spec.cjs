const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const page = readFileSync(resolve(__dirname, "../app/account/page.tsx"), "utf8");
const auth = readFileSync(resolve(__dirname, "../../api/src/auth/auth.service.ts"), "utf8");

test("signed-in customers can review memberships and settled renewal history", () => {
  assert.match(auth, /memberships: \{/);
  assert.match(auth, /checkouts: \{\s*where: \{ status: "PAID" \}/);
  assert.match(page, /My memberships/);
  assert.match(page, /Enrollment &amp; renewal history/);
  assert.match(page, /membership\.purchases\.map/);
  assert.match(page, /View membership options/);
});
