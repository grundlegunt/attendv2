const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/clients/clients-page.tsx"), "utf8");

test("Master client remittances support audited collection notes", () => {
  assert.match(source, /function editTicketFeeRemittanceNotes/);
  assert.match(source, /window\.prompt\("Collection notes"/);
  assert.match(source, /JSON\.stringify\(\{ status, notes: notes\.trim\(\) \|\| null \}\)/);
  assert.match(source, /Collection note: \{remittance\.notes\}/);
  assert.match(source, /remittance\.notes \? "Edit note" : "Add note"/);
});

test("financial reconciliation notes remain separate from editable collection notes", () => {
  const paymentsSource = readFileSync(resolve(__dirname, "../app/payments/page.tsx"), "utf8");
  assert.match(source, /Reconciliation: \{remittance\.reconciliationNote\}/);
  assert.match(source, /Collection note: \{remittance\.notes\}/);
  assert.match(paymentsSource, /Reconciliation note/);
  assert.match(paymentsSource, /remittance\.reconciliationNote \?\? ""/);
});

test("Master client remittances schedule and display collection follow-ups", () => {
  assert.match(source, /function logTicketFeeRemittanceContact/);
  assert.match(source, /lastContactedAt: new Date\(\)\.toISOString\(\)/);
  assert.match(source, /nextFollowUpAt:/);
  assert.match(source, />Log contact<\/button>/);
  assert.match(source, /Last contacted/);
  assert.match(source, /Next follow-up/);
  assert.match(source, /collectionOwnerId: session\.user\.id/);
  assert.match(source, /function assignTicketFeeRemittanceToMe/);
  assert.match(source, />Assign to me<\/button>/);
  assert.match(source, /Collection owner:/);
});

test("remittance ledgers keep settlement reconciliation visible", () => {
  const paymentsSource = readFileSync(resolve(__dirname, "../app/payments/page.tsx"), "utf8");
  for (const pageSource of [source, paymentsSource]) {
    assert.match(pageSource, /platformShareCents \+ remittance\.operatorShareCents/);
    assert.match(pageSource, /feeVarianceLabel\(remittance\.varianceCents\)/);
  }
});

test("settlement variance labels explain over- and under-collection", () => {
  const paymentsSource = readFileSync(resolve(__dirname, "../app/payments/page.tsx"), "utf8");
  for (const pageSource of [source, paymentsSource]) {
    assert.match(pageSource, /function feeVarianceLabel/);
    assert.match(pageSource, /money\(Math\.abs\(cents\)\)/);
    assert.match(pageSource, /cents > 0 \? "over-collected" : "under-collected"/);
  }
});

test("paid remittances require a non-empty payment reference", () => {
  const apiSource = readFileSync(resolve(__dirname, "../../api/src/platform/platform.service.ts"), "utf8");
  assert.match(source, /!paymentReference\?\.trim\(\)/);
  assert.match(source, /Enter a payment reference before marking this remittance paid/);
  assert.match(apiSource, /status === "PAID" && !paymentReference/);
  assert.match(apiSource, /A payment reference is required before a ticket-fee remittance can be marked paid/);
});

test("voided remittances require and retain an audit reason", () => {
  const apiSource = readFileSync(resolve(__dirname, "../../api/src/platform/platform.service.ts"), "utf8");
  const schemaSource = readFileSync(resolve(__dirname, "../../../packages/database/prisma/schema.prisma"), "utf8");
  assert.match(source, /window\.prompt\("Reason for voiding this remittance"\)/);
  assert.match(source, /Enter a reason before voiding this remittance/);
  assert.match(source, /Voided remittance reasons/);
  assert.match(apiSource, /status === "VOID" && !voidReason/);
  assert.match(apiSource, /A reason is required before a ticket-fee remittance can be voided/);
  assert.match(schemaSource, /voidReason\s+String\?/);
});
