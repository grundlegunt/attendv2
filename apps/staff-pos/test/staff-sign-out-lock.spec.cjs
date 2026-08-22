const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/page.tsx"), "utf8");

test("staff sign out is locked before the logout request starts", () => {
  assert.match(source, /const signOutPendingRef = useRef\(false\)/);
  assert.match(source, /function signOut\(\) \{\s*if \(signOutPendingRef\.current\) return;\s*signOutPendingRef\.current = true/);
  assert.match(source, /\.finally\(\(\) => \{ signOutPendingRef\.current = false; \}\)/);
});
