const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/operations/page.tsx"), "utf8");

test("Master provides a prioritized cross-operator operations queue", () => {
  assert.match(source, /Operations Queue/);
  assert.match(source, /Failed payments in the last 24 hours/);
  assert.match(source, /Payments awaiting verification/);
  assert.match(source, /Overdue remittance follow-ups/);
  assert.match(source, /Remittances without a scheduled follow-up/);
  assert.match(source, /Unassigned ticket-fee remittances/);
  assert.match(source, /Failed refunds/);
  assert.match(source, /Expired seat holds awaiting cleanup/);
  assert.match(source, /Missing \$\{missing\.join/);
  assert.match(source, /right\.priority - left\.priority/);
});

test("operations queue supports focused resolution workflows", () => {
  assert.match(source, /Search queue/);
  assert.match(source, /All categories/);
  assert.match(source, /Affected clients/);
  assert.match(source, /Resolve →/);
  assert.match(source, /\/payments\?organizationId=/);
  assert.match(source, /followUp=OVERDUE/);
  assert.match(source, /followUp=UNASSIGNED/);
  assert.match(source, /owner=UNASSIGNED/);
  assert.match(source, /age=60_PLUS/);
  assert.match(source, /age=31_60/);
  assert.match(source, /age=1_30/);
  assert.match(source, /Critical ticket-fee remittances/);
  assert.match(source, /exposureCents\?: number/);
  assert.match(source, /exposure\(overdue60Plus\)/);
  assert.match(source, /exposure\(unassignedRemittances\)/);
  assert.match(source, /exposure\(unscheduledFollowUps\)/);
  assert.match(source, />Impact<\/span>/);
  assert.match(source, /money\(item\.exposureCents\)/);
  assert.match(source, /locationId=/);
});

test("operations queue exports the current filtered view for handoffs", () => {
  assert.match(source, /function exportOperationsQueue\(\)/);
  assert.match(source, /const rows = items\.map/);
  assert.match(source, /"Resolution URL"/);
  assert.match(source, /ringo-operations-queue-/);
  assert.match(source, /Export queue CSV/);
});

test("operations queue exposes priority for rapid triage", () => {
  assert.match(source, /function priorityLabel/);
  assert.match(source, /All priorities/);
  assert.match(source, /priorityLabel\(item\.priority\) === priority/);
  assert.match(source, />Urgent<\/option>/);
  assert.match(source, />High<\/option>/);
  assert.match(source, />Priority<\/span>/);
  assert.match(source, /operations-priority/);
});

test("operations summary highlights and opens urgent work", () => {
  assert.match(source, /const urgentItems = allItems\.filter/);
  assert.match(source, /Urgent groups/);
  assert.match(source, /urgentItems\.length/);
  assert.match(source, /onClick=\{\(\) => setPriority\("Urgent"\)\}/);
  assert.match(source, /View urgent only →/);
});

test("operations queue refreshes without allowing stale responses", () => {
  assert.match(source, /const refreshOverview = useCallback/);
  assert.match(source, /overviewRequestRef/);
  assert.match(source, /requestId === overviewRequestRef\.current/);
  assert.match(source, /window\.setInterval/);
  assert.match(source, /60_000/);
  assert.match(source, /Refresh queue/);
  assert.match(source, /Refreshing…/);
});

test("operations queue filters handoffs by client", () => {
  assert.match(source, /const clients = useMemo/);
  assert.match(source, /item\.client === client/);
  assert.match(source, /All clients/);
  assert.match(source, /clients\.map\(\(name\)/);
  assert.match(source, /setClient\("ALL"\)/);
});
