const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const root = join(__dirname, "../../..");
const service = readFileSync(join(root, "apps/api/src/platform/platform.service.ts"), "utf8");
const controller = readFileSync(join(root, "apps/api/src/platform/platform.controller.ts"), "utf8");
const page = readFileSync(join(root, "apps/platform-admin/app/distributors/page.tsx"), "utf8");

test("Master exposes authenticated cross-operator distributor intelligence", () => {
  assert.match(controller, /@Get\("distributors"\)[\s\S]*@UseGuards\(PlatformAuthGuard\)[\s\S]*distributorPortfolio/);
  assert.match(service, /async distributorPortfolio\(input: \{ from\?: string; to\?: string \} = \{\}\)/);
  assert.match(controller, /distributors\(@Query\("from"\) from\?: string, @Query\("to"\) to\?: string\)/);
  assert.match(service, /distributorName: \{ not: null \}/);
  assert.match(service, /distributorTerms: true/);
});

test("distributor reporting excludes refunded tickets and distinguishes deal timing", () => {
  assert.match(service, /status: \{ notIn: \["REFUNDED", "CANCELED"\] \}/);
  assert.match(service, /status: pastShows > 0 && upcomingShows > 0 \? "CURRENT" : upcomingShows > 0 \? "UPCOMING" : pastShows > 0 \? "PAST" : "UNSCHEDULED"/);
  assert.match(service, /ticketFaceValueCents/);
  assert.match(service, /allocateDistributorShare\(showtimeRevenueCents, showtime\.startsAt, openingStartsAt, movie\.distributorTerms\)/);
  assert.match(service, /unallocatedRevenueCents/);
  assert.match(service, /const reportingShowtimes = range \? movie\.showtimes\.filter/);
  assert.match(service, /const openingStartsAt = movie\.showtimes\.reduce/);
  assert.match(service, /Both distributor performance range dates are required/);
});

test("Master distributor workspace shows portfolios, performance, and terms readiness", () => {
  assert.match(page, /DISTRIBUTOR INTELLIGENCE/);
  assert.match(page, /Ticket face value/);
  assert.match(page, /Distributor share/);
  assert.match(page, /Cinema share/);
  assert.match(page, /Needs terms/);
  assert.match(page, /function termsSummary/);
  assert.match(page, /distributorShareBasisPoints \/ 100/);
  assert.match(page, /Deal schedule/);
  assert.match(page, /href=\{`\/films\/\$\{deal\.catalogEntryId\}`\}/);
  assert.match(page, /type RangeKey = "30" \| "90" \| "all"/);
  assert.match(page, /Distributor performance range/);
  assert.match(page, /`\/platform\/distributors\$\{rangeQuery\(range\)\}`/);
});

test("Master exports engagement-level distributor settlements", () => {
  assert.match(controller, /@Get\("distributors\.csv"\)/);
  assert.match(service, /distributorPortfolioCsv/);
  assert.match(service, /"Distributor share \(cents\)"/);
  assert.match(service, /"Unallocated \(cents\)"/);
  assert.match(service, /"Deal terms \(JSON\)"/);
  assert.match(service, /JSON\.stringify\(deal\.terms\)/);
  assert.match(page, /Export settlements/);
  assert.match(page, /platformDownload\(API_BASE_URL, STORAGE_KEY, `\/platform\/distributors\.csv\$\{rangeQuery\(range\)\}`/);
});
