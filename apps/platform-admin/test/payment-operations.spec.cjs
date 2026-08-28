const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/payments/page.tsx"), "utf8");

test("Attend Master payment operations exposes factual client health", () => {
  assert.match(source, /Failed payments · 24h/);
  assert.match(source, /Payment failure · 7d/);
  assert.match(source, /Refund rate · 7d/);
  assert.match(source, /prior 7d/);
  assert.match(source, /Processing now/);
  assert.match(source, /Payment reviews/);
  assert.match(source, /Failed refunds/);
  assert.match(source, /Stale payments/);
  assert.match(source, /Stale refunds/);
  assert.match(source, /Manager-review tabs/);
  assert.match(source, /Expired seat holds/);
  assert.match(source, /Last completed:/);
});

test("payment operations can focus on clients with actual exceptions", () => {
  assert.match(source, /Show exceptions only/);
  assert.match(source, /const openRemittances = organization\.ticketFeeRemittances\.filter\(\(remittance\) => remittance\.status === "DUE"\)\.length/);
  assert.match(source, /organization\.health\.expiredHoldBacklog \+ openRemittances === 0/);
  assert.match(source, /params\.get\("exceptions"\) === "true"/);
});

test("payment operations exports and displays remittance collection health", () => {
  assert.match(source, /Open fee remittances/);
  assert.match(source, /Overdue fee remittances/);
  assert.match(source, /Ringo receivable due/);
  assert.match(source, /open fee remittances/);
  assert.match(source, /Collections workflow totals/);
  assert.match(source, /Open receivables/);
  assert.match(source, /Overdue receivables/);
  assert.match(source, /Follow-ups overdue/);
  assert.match(source, /Without follow-up/);
});

test("payment operations prioritizes remittances by aging bucket", () => {
  assert.match(source, /type RemittanceAgingFilter = "ALL" \| "CURRENT" \| "1_30" \| "31_60" \| "60_PLUS" \| "PAID"/);
  assert.match(source, /function daysOverdue/);
  assert.match(source, /1–30 days/);
  assert.match(source, /31–60 days/);
  assert.match(source, /60\+ days/);
  assert.match(source, /No remittances match this aging view/);
});

test("payment operations filters the collections ledger by follow-up status", () => {
  assert.match(source, /type RemittanceFollowUpFilter = "ALL" \| "OVERDUE" \| "UPCOMING" \| "UNASSIGNED"/);
  assert.match(source, /remittanceFollowUpFilter === "UNASSIGNED"/);
  assert.match(source, />All follow-ups<\/option>/);
  assert.match(source, />Not scheduled<\/option>/);
});

test("payment operations filters receivables by collection owner", () => {
  assert.match(source, /const collectionOwners = useMemo/);
  assert.match(source, /remittanceOwnerFilter === "UNASSIGNED"/);
  assert.match(source, />All owners<\/option>/);
  assert.match(source, /collectionOwners\.map\(\(owner\)/);
});

test("payment operations bulk assigns filtered open receivables", () => {
  assert.match(source, /const assignableDisplayedRemittances = displayedRemittances\.filter/);
  assert.match(source, /function assignFilteredRemittancesToMe\(\)/);
  assert.match(source, /JSON\.stringify\(\{ collectionOwnerId: session\.user\.id \}\)/);
  assert.match(source, /Assign \$\{assignableDisplayedRemittances\.length\} to me/);
  assert.match(source, /session\.user\.role !== "VIEWER"/);
  assert.match(source, /failed \+= 1/);
});

test("payment operations bulk schedules follow-ups for filtered open receivables", () => {
  assert.match(source, /const schedulableDisplayedRemittances = displayedRemittances\.filter/);
  assert.match(source, /function scheduleFilteredRemittanceFollowUps\(\)/);
  assert.match(source, /nextFollowUpAt: `\$\{bulkFollowUpDate\}T23:59:59\.999Z`/);
  assert.match(source, /collectionOwnerId: remittance\.collectionOwner\?\.id \?\? session\.user\.id/);
  assert.match(source, />Bulk follow-up/);
  assert.match(source, /Schedule \$\{schedulableDisplayedRemittances\.length\}/);
  assert.match(source, /min=\{new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\}/);
});

test("payment operations summarizes collection owner workload", () => {
  assert.match(source, /const collectionOwnerWorkload = useMemo/);
  assert.match(source, /aria-label="Collection owner workload"/);
  assert.match(source, /Open receivables and follow-up coverage/);
  assert.match(source, /owner\.overdueFollowUps/);
  assert.match(source, /owner\.unscheduledFollowUps/);
  assert.match(source, /setRemittanceOwnerFilter\(owner\.id\)/);
});

test("payment operations exports collection owner workload", () => {
  assert.match(source, /function exportCollectionOwnerWorkload\(\)/);
  assert.match(source, /collectionOwnerWorkload\.map/);
  assert.match(source, /"Upcoming follow-ups"/);
  assert.match(source, /ringo-collection-owner-workload-/);
  assert.match(source, />Export owner workload<\/button>/);
});

test("payment operations supports operator-scoped collections deep links", () => {
  assert.match(source, /setRemittanceOrganizationFilter\(organizationId\)/);
  assert.match(source, /params\.get\("followUp"\)/);
  assert.match(source, /params\.get\("owner"\)/);
  assert.match(source, /setRemittanceOwnerFilter\(owner\)/);
  assert.match(source, /params\.get\("age"\)/);
  assert.match(source, /setRemittanceAgingFilter\(age\)/);
  assert.match(source, /remittance\.organizationId !== remittanceOrganizationFilter/);
  assert.match(source, />All operators<\/option>/);
});

test("payment operations summarizes receivables by operator", () => {
  assert.match(source, /const operatorReceivables = useMemo/);
  assert.match(source, /aria-label="Receivables by operator"/);
  assert.match(source, />Open balance</);
  assert.match(source, />Oldest</);
  assert.match(source, />View ledger</);
});

test("payment operations identifies operator collection risk", () => {
  assert.match(source, /days60PlusCents > 0 \? "CRITICAL"/);
  assert.match(source, /days31To60Cents > 0 \? "ESCALATE"/);
  assert.match(source, />Risk<\/span>/);
  assert.match(source, /at 31–60/);
  assert.match(source, /at 60\+/);
});

test("payment operations exports operator-level collection risk", () => {
  assert.match(source, /function exportOperatorReceivables\(\)/);
  assert.match(source, /"Collection risk"/);
  assert.match(source, /ringo-operator-receivables-/);
  assert.match(source, />Export operator summary<\/button>/);
});

test("payment operations filters operators by collection risk", () => {
  assert.match(source, /type OperatorRiskFilter/);
  assert.match(source, /const displayedOperatorReceivables = useMemo/);
  assert.match(source, /operator\.risk === operatorRiskFilter/);
  assert.match(source, />All risk tiers<\/option>/);
  assert.match(source, /displayedOperatorReceivables\.map/);
});

test("payment operations exports the filtered aged-receivables ledger", () => {
  assert.match(source, /function exportAgedReceivables/);
  assert.match(source, /displayedRemittances\.map/);
  assert.match(source, /Days overdue/);
  assert.match(source, /ringo-aged-receivables-/);
  assert.match(source, />Export aging CSV<\/button>/);
  assert.match(source, /Collection notes/);
  assert.match(source, /Last contacted/);
  assert.match(source, /Next follow-up/);
  assert.match(source, /Collection owner/);
  assert.match(source, /Collection owner email/);
  assert.match(source, /Owner: \{remittance\.collectionOwner\?\.name/);
  assert.match(source, /Note: \{remittance\.notes\}/);
});

test("payment operations can find clients and filter Stripe readiness", () => {
  assert.match(source, /Find client/);
  assert.match(source, /Cinema or legal name/);
  assert.match(source, /Stripe status/);
  assert.match(source, /All statuses/);
  assert.match(source, /Clear filters/);
  assert.match(source, /organization\.payments\.onboardingStatus !== onboardingStatus/);
});

test("payment operations exports the current filtered client view", () => {
  assert.match(source, /function exportPaymentOperations/);
  assert.match(source, /displayedOrganizations\.map/);
  assert.match(source, /ringo-master-payment-operations-/);
  assert.match(source, />Export CSV<\/button>/);
});
