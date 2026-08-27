const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const platform = readFileSync(resolve(__dirname, "../../api/src/platform/platform.service.ts"), "utf8");
const filmPage = readFileSync(resolve(__dirname, "../app/films/[id]/page.tsx"), "utf8");

test("Master combines film concessions, promotions, comps, and refunds across operators", () => {
  assert.match(platform, /for \(const promotion of report\.promotions\)/);
  assert.match(platform, /for \(const item of report\.fnbItems\)/);
  assert.match(platform, /sum\.complimentaryTickets \+= row\.totals\.complimentaryTickets/);
  assert.match(platform, /sum\.refundedTicketValueCents \+= row\.totals\.refundedTicketValueCents/);
});

test("film intelligence exposes commercial performance and revenue leakage", () => {
  assert.match(filmPage, /Top F&amp;B items/);
  assert.match(filmPage, /Offer performance/);
  assert.match(filmPage, /totals\.discountCents/);
  assert.match(filmPage, /totals\.complimentaryTickets/);
  assert.match(filmPage, /totals\.refundedTickets/);
  assert.match(filmPage, /item\.salesCents/);
  assert.match(filmPage, /promotion\.discountCents/);
});
