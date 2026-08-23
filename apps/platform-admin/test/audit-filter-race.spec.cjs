const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/audit/page.tsx"), "utf8");

test("only the newest audit-filter request may update the event list", () => {
  assert.match(source, /const eventsRequestRef = useRef\(0\)/);
  assert.match(source, /const requestId = \+\+eventsRequestRef\.current/);
  assert.match(source, /if \(requestId !== eventsRequestRef\.current\) return;\s*setEvents/);
  assert.match(source, /requestId === eventsRequestRef\.current\) setLoading\(false\)/);
});

test("audit requests are invalidated when the platform session changes", () => {
  assert.match(source, /return \(\) => \{ active = false; eventsRequestRef\.current \+= 1; \}/);
  assert.match(source, /eventsRequestRef\.current \+= 1;\s*setSession\(null\)/);
});
