const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const page = readFileSync(join(__dirname, "../app/films/[id]/page.tsx"), "utf8");

test("Master film intelligence supports custom inclusive date ranges", () => {
  assert.match(page, /type RangeKey = "30" \| "90" \| "all" \| "custom"/);
  assert.match(page, /value === "custom" \? "Custom"/);
  assert.match(page, /range === "custom" && <div className="custom-range film-custom-range">/);
  assert.match(page, /`\?from=\$\{encodeURIComponent\(`\$\{customFrom\}T00:00:00\.000Z`\)\}&to=\$\{encodeURIComponent\(`\$\{customTo\}T23:59:59\.999Z`\)\}`/);
  assert.match(page, /load\(session, range, customFrom, customTo\)/);
  assert.match(page, /performance\.csv\$\{queryString\}/);
});
