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

test("film series mutations share an immediate action lock", () => {
  assert.match(source, /const seriesActionRef = useRef\(false\)/);
  assert.equal(source.match(/if \(seriesActionRef\.current\) return;\s*seriesActionRef\.current = true/g)?.length, 4);
  assert.equal(source.match(/seriesActionRef\.current = false;\s*setSeriesSaving\(false\)/g)?.length, 4);
  assert.match(source, /draggable=\{!seriesSaving\}/);
});
