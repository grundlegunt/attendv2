const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/film-series/page.tsx"), "utf8");

test("film series creation retains a stable retry identity", () => {
  assert.match(source, /createSeriesAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": createSeriesAttemptRef\.current\.requestId/);
  assert.match(source, /reason instanceof ApiRequestError && reason\.status < 500/);
});
