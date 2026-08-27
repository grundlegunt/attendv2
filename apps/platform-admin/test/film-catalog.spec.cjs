const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/films/page.tsx"), "utf8");
const performanceSource = readFileSync(
  join(__dirname, "../app/films/[id]/page.tsx"),
  "utf8",
);
const serviceSource = readFileSync(
  join(__dirname, "../../api/src/platform/platform.service.ts"),
  "utf8",
);

test("Master film catalog supports discovery and lifecycle management", () => {
  assert.match(source, /\/platform\/film-catalog\?\$\{params\}/);
  assert.match(source, /includeInactive/);
  assert.match(source, /Needs review/);
  assert.match(source, /Verified by Ringo/);
  assert.match(source, /Active and searchable by operators/);
  assert.match(source, /cannot see any operator film records/);
  assert.match(source, /Confirm Master and Admin use the same API and database/);
  assert.match(source, /All.*catalog records are inactive/);
  assert.match(source, /operator film records linked/);
  assert.match(source, /active catalog films/);
  assert.match(source, /waiting to synchronize/);
  assert.match(serviceSource, /syncStatus: \{/);
  assert.match(serviceSource, /unlinkedOperatorMovieCount: operatorMovieCount - linkedOperatorMovieCount/);
});

test("Master film catalog keeps viewers read-only", () => {
  assert.match(source, /session\.user\.role === "VIEWER"/);
  assert.match(source, /disabled=\{readOnly\}/);
  assert.match(source, /\{!readOnly && <button/);
});

test("operator film synchronization allows a production-sized transaction window", () => {
  assert.match(serviceSource, /platform-film-catalog-sync/);
  assert.match(serviceSource, /maxWait: 5_000/);
  assert.match(serviceSource, /timeout: 15_000/);
});

test("Master film catalog opens cross-operator film intelligence", () => {
  assert.match(source, /catalog-performance-link/);
  assert.match(
    performanceSource,
    /\/platform\/film-catalog\/\$\{encodeURIComponent\(filmId\)\}\/performance/,
  );
  assert.match(performanceSource, /\["30", "90", "all", "custom"\]/);
  assert.match(performanceSource, /`\$\{value\} days`/);
  assert.match(performanceSource, /All time/);
  assert.match(performanceSource, /Distributor share/);
  assert.match(performanceSource, /Cinema share/);
  assert.match(performanceSource, /Needs terms/);
  assert.match(performanceSource, /private terms remain/);
});
