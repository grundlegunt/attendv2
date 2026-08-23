const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/admin-session.tsx"), "utf8");

test("admin branding ignores responses for superseded cinema locations", () => {
  assert.match(source, /const brandingRequestRef = useRef\(0\)/);
  assert.match(source, /const requestId = \+\+brandingRequestRef\.current/);
  assert.match(source, /setPublicBranding\(null\)/);
  assert.match(source, /requestId === brandingRequestRef\.current\) setPublicBranding\(nextBranding\)/);
  assert.match(source, /return \(\) => \{ brandingRequestRef\.current \+= 1; \}/);
});
