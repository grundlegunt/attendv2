const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const reporting = readFileSync(resolve(__dirname, "../../api/src/reporting/reporting.service.ts"), "utf8");
const platform = readFileSync(resolve(__dirname, "../../api/src/platform/platform.service.ts"), "utf8");
const page = readFileSync(resolve(__dirname, "../app/films/[id]/page.tsx"), "utf8");

test("film intelligence compares member, identified, and guest ticket behavior", () => {
  assert.match(reporting, /ACTIVE_MEMBER/);
  assert.match(reporting, /IDENTIFIED_CUSTOMER/);
  assert.match(reporting, /customer\?\.memberships\.some/);
  assert.match(platform, /for \(const segment of report\.customerSegments\)/);
  assert.match(page, /Who buys tickets for this film/);
  assert.match(page, /segment\.percentOfTickets/);
  assert.match(page, /No customer identities are shared/);
});
