const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/page.tsx"), "utf8");

test("KDS queue polling never overlaps slow refreshes", () => {
  assert.match(source, /queueRefreshPendingRef = useRef\(false\)/);
  assert.match(source, /if \(!accessToken \|\| !stationId \|\| queueRefreshPendingRef\.current\) return/);
  assert.match(source, /queueRefreshPendingRef\.current = true/);
  assert.match(source, /queueRefreshPendingRef\.current = false/);
});

test("KDS ignores stale queue responses after station or session changes", () => {
  assert.match(source, /queueRefreshRequestRef = useRef\(0\)/);
  assert.match(source, /const requestId = \+\+queueRefreshRequestRef\.current/);
  assert.match(source, /if \(requestId !== queueRefreshRequestRef\.current\) return/);
  assert.match(source, /function selectStation[\s\S]*?queueRefreshRequestRef\.current \+= 1/);
  assert.match(source, /function signOut[\s\S]*?queueRefreshRequestRef\.current \+= 1/);
});
