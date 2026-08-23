const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/page.tsx"), "utf8");

test("KDS ignores session and station responses superseded by sign out", () => {
  assert.match(source, /const sessionRequestRef = useRef\(0\)/);
  assert.match(source, /async function refreshSession[\s\S]*?const requestId = \+\+sessionRequestRef\.current/);
  assert.match(source, /function signOut\(\) \{\s+sessionRequestRef\.current \+= 1/);
  assert.match(source, /async function login[\s\S]*?const requestId = \+\+sessionRequestRef\.current/);
  assert.match(source, /const requestId = \+\+stationRequestRef\.current/);
  assert.match(source, /return \(\) => \{ stationRequestRef\.current \+= 1; \}/);
});
