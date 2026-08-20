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

test("film series edits retain a stable retry identity and version", () => {
  assert.match(source, /updateSeriesAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": updateSeriesAttemptRef\.current\.requestId/);
  assert.match(source, /"If-Unmodified-Since": editingSeriesUpdatedAt/);
});

test("film series archiving retains a stable retry identity", () => {
  assert.match(source, /archiveSeriesAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": archiveSeriesAttemptRef\.current\.requestId/);
});

test("film series restoration retains a stable retry identity", () => {
  assert.match(source, /restoreSeriesAttemptRef = useRef/);
  assert.match(source, /film-series\/\$\{series\.id\}\/restore/);
  assert.match(source, /"Idempotency-Key": restoreSeriesAttemptRef\.current\.requestId/);
});

test("film series reordering is atomic and retains a stable retry identity", () => {
  assert.match(source, /reorderSeriesAttemptRef = useRef/);
  assert.match(source, /apiFetch\("\/cinema\/film-series\/reorder"/);
  assert.match(source, /"Idempotency-Key": reorderSeriesAttemptRef\.current\.requestId/);
  assert.doesNotMatch(source, /Promise\.all\(reordered\.map/);
});
