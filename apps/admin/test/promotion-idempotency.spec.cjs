const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/management-dashboard.tsx"), "utf8");

test("promotion creation retains a stable retry identity", () => {
  assert.match(source, /promotionAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": promotionAttemptRef\.current\.requestId/);
  assert.match(source, /reason\.status < 500/);
});

test("promotion updates retain a stable retry identity", () => {
  assert.match(source, /updatePromotionAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": updatePromotionAttemptRef\.current\.requestId/);
});

test("promotion mutations share an immediate action lock", () => {
  assert.match(source, /promotionActionRef = useRef\(false\)/);
  assert.equal(source.match(/if \(promotionActionRef\.current\) return;/g)?.length, 3);
  assert.equal(source.match(/promotionActionRef\.current = true;/g)?.length, 3);
  assert.equal(source.match(/finally \{ promotionActionRef\.current = false; setPromotionAction\(null\); \}/g)?.length, 3);
  assert.match(source, /Creating…/);
  assert.match(source, /Saving…/);
  assert.match(source, /Updating…/);
});
