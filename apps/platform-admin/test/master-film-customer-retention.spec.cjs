const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const reporting = readFileSync(resolve(__dirname, "../../api/src/reporting/reporting.service.ts"), "utf8");
const platform = readFileSync(resolve(__dirname, "../../api/src/platform/platform.service.ts"), "utf8");
const page = readFileSync(resolve(__dirname, "../app/films/[id]/page.tsx"), "utf8");

test("film intelligence compares new and returning customer relationships", () => {
  assert.match(reporting, /filmCustomerFirstPurchase/);
  assert.match(reporting, /ticketOrder\.groupBy/);
  assert.match(reporting, /firstCompletedPurchase < firstFilmPurchase/);
  assert.match(platform, /report\.customerRetention\.identifiedCustomers/);
  assert.match(page, /Does this film bring customers back\?/);
  assert.match(page, /Guests are excluded/);
  assert.match(page, /returningPercent/);
});
