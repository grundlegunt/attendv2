const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/films/page.tsx"), "utf8");

test("operators can find and import canonical films from their library", () => {
  assert.match(source, /\/cinema\/film-catalog\?\$\{params\}/);
  assert.match(source, /\/cinema\/film-catalog\/\$\{encodeURIComponent\(film\.id\)\}\/import/);
  assert.match(source, /Your cinema’s bookings, deal terms, pricing, and performance remain private/);
  assert.match(source, /Already in library/);
});
