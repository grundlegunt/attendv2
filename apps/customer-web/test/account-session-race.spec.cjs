const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/account/page.tsx"), "utf8");

test("customer account ignores session responses superseded by sign out", () => {
  assert.match(source, /const sessionRequestRef = useRef\(0\)/);
  assert.match(source, /useEffect\(\(\) => \{\s+const requestId = \+\+sessionRequestRef\.current;\s+setRestoreError/);
  assert.match(source, /async function handleSubmit[\s\S]*?const requestId = \+\+sessionRequestRef\.current/);
  assert.match(source, /async function signOut[\s\S]*?sessionRequestRef\.current \+= 1/);
  assert.match(source, /async function changePassword[\s\S]*?const requestId = \+\+sessionRequestRef\.current/);
  assert.match(source, /async function updateProfile[\s\S]*?const requestId = sessionRequestRef\.current/);
  assert.match(source, /return \(\) => \{ sessionRequestRef\.current \+= 1; \}/);
});
