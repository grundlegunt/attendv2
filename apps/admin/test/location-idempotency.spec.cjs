const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../app/management-dashboard.tsx"), "utf8");

test("location settings saves retain a stable retry identity", () => {
  assert.match(source, /locationAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": locationAttemptRef\.current\.requestId/);
  assert.match(source, /locationSavingRef = useRef\(false\)/);
  assert.match(source, /if \(locationSavingRef\.current\) return;/);
  assert.match(source, /finally \{[\s\S]*locationSavingRef\.current = false;[\s\S]*setLocationSaving\(false\);/);
  assert.match(source, /locationSaving \? "Saving…" : "Save operating settings"/);
});

test("branding saves retain a stable retry identity", () => {
  assert.match(source, /brandingAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": brandingAttemptRef\.current\.requestId/);
});

test("merch link saves retain a stable retry identity", () => {
  assert.match(source, /merchAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": merchAttemptRef\.current\.requestId/);
});

test("customer site copy saves retain a stable retry identity", () => {
  assert.match(source, /siteCopyAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": siteCopyAttemptRef\.current\.requestId/);
});
