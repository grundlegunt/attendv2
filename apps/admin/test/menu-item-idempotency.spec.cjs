const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/menu-manager.tsx"), "utf8");

test("menu item creation retains a stable retry identity", () => {
  assert.match(source, /itemAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": itemAttemptRef\.current\.requestId/);
  assert.match(source, /error\.status < 500/);
});

test("menu structure creation retains stable retry identities", () => {
  assert.match(source, /categoryAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": categoryAttemptRef\.current\.requestId/);
  assert.match(source, /stationAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": stationAttemptRef\.current\.requestId/);
});

test("menu category updates retain a stable retry identity", () => {
  assert.match(source, /updateCategoryAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": updateCategoryAttemptRef\.current\.requestId/);
});

test("kitchen station updates retain a stable retry identity", () => {
  assert.match(source, /updateStationAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": updateStationAttemptRef\.current\.requestId/);
});

test("modifier creation retains stable retry identities", () => {
  assert.match(source, /modifierGroupAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": modifierGroupAttemptRef\.current\.requestId/);
  assert.match(source, /modifierAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": modifierAttemptRef\.current\.requestId/);
});

test("menu presentation publishing retains a stable retry identity", () => {
  assert.match(source, /menuPresentationAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": menuPresentationAttemptRef\.current\.requestId/);
});
