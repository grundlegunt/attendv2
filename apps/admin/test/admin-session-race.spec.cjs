const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/admin-session.tsx"), "utf8");

test("sign out invalidates pending session responses", () => {
  assert.match(source, /const sessionRequestRef = useRef\(0\)/);
  assert.match(source, /async function refreshSession[\s\S]*?const requestId = \+\+sessionRequestRef\.current/);
  assert.match(source, /if \(requestId !== sessionRequestRef\.current\) return null/);
  assert.match(source, /async function login[\s\S]*?if \(requestId !== sessionRequestRef\.current\) return/);
  assert.match(source, /async function changePassword[\s\S]*?if \(requestId !== sessionRequestRef\.current\) return/);
  assert.match(source, /signOut: \(\) => \{\s+sessionRequestRef\.current \+= 1/);
});
