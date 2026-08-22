const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/admin-dashboard.tsx"), "utf8");

test("dashboard seat previews serialize requests and cancel them on teardown", () => {
  assert.match(source, /if \(inventory \|\| inventoryRequestRef\.current\) return/);
  assert.match(source, /inventoryRequestRef\.current = controller/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /inventoryRequestRef\.current\?\.abort\(\)/);
});

test("dashboard seat previews allow retry after a transient failure", () => {
  assert.doesNotMatch(source, /if \(inventory \|\| inventoryLoading \|\| inventoryError\) return/);
  assert.match(source, /setInventoryError\(false\)/);
  assert.match(source, /if \(!controller\.signal\.aborted\) setInventoryError\(true\)/);
});

test("top films preview the closest showing and link to their revenue row", () => {
  assert.match(source, /closestShowtimeByMovie/);
  assert.match(source, /className="dashboard-seat-preview top-film-seat-preview"/);
  assert.match(source, /href=\{`\/reports#movie-\$\{encodeURIComponent\(film\.movieId\)\}`\}/);
  assert.match(source, /onMouseEnter=\{loadInventory\}/);
});
