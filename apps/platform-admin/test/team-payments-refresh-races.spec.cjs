const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const team = readFileSync(resolve(__dirname, "../app/team/page.tsx"), "utf8");
const payments = readFileSync(resolve(__dirname, "../app/payments/page.tsx"), "utf8");

test("only the newest Attend team refresh updates the roster", () => {
  assert.match(team, /const teamRequestRef = useRef\(0\)/);
  assert.match(team, /const requestId = \+\+teamRequestRef\.current/);
  assert.match(team, /requestId === teamRequestRef\.current\) setUsers/);
  assert.match(team, /teamRequestRef\.current \+= 1; setSession\(null\)/);
});

test("only the newest payment overview refresh updates readiness", () => {
  assert.match(payments, /const overviewRequestRef = useRef\(0\)/);
  assert.match(payments, /const requestId = \+\+overviewRequestRef\.current/);
  assert.match(payments, /requestId === overviewRequestRef\.current\) setOverview/);
  assert.match(payments, /overviewRequestRef\.current \+= 1;\s*setSession\(null\)/);
});
