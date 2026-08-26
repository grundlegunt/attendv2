const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const root = join(__dirname, "../../..");
const reporting = readFileSync(join(root, "apps/api/src/reporting/reporting.service.ts"), "utf8");
const platform = readFileSync(join(root, "apps/api/src/platform/platform.service.ts"), "utf8");
const dashboard = readFileSync(join(root, "apps/platform-admin/app/page.tsx"), "utf8");
const clients = readFileSync(join(root, "apps/platform-admin/app/clients/clients-page.tsx"), "utf8");

test("Master revenue includes only completed membership and donation collections", () => {
  assert.match(reporting, /prisma\.membershipCheckout\.findMany/);
  assert.match(reporting, /status: "PAID"/);
  assert.match(reporting, /prisma\.donation\.findMany/);
  assert.match(reporting, /status: "SETTLED"/);
  assert.match(reporting, /membershipRevenueCents \+= checkout\.amountCents/);
  assert.match(reporting, /donationRevenueCents \+= donation\.amountCents/);
});

test("cinema sales and nonprofit collections remain separately identifiable", () => {
  assert.match(reporting, /combinedRevenueCents = totals\.ticketCollectedCents \+ totals\.fnbRevenueCents/);
  assert.match(reporting, /nonprofitRevenueCents = totals\.membershipRevenueCents \+ totals\.donationRevenueCents/);
  assert.match(reporting, /totalCollectedCents = totals\.combinedRevenueCents \+ totals\.nonprofitRevenueCents/);
  assert.match(platform, /"Membership and donation collections \(cents\)"/);
  assert.match(platform, /"All collected \(cents\)"/);
});

test("Master dashboard and client workspace expose both contribution sources", () => {
  for (const source of [dashboard, clients]) {
    assert.match(source, /membershipRevenueCents/);
    assert.match(source, /donationRevenueCents/);
    assert.match(source, /totalCollectedCents/);
  }
});
