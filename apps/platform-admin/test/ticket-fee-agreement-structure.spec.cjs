const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/clients/clients-page.tsx"), "utf8");
const apiSource = readFileSync(resolve(__dirname, "../../api/src/platform/platform.service.ts"), "utf8");

test("commercial agreements offer explicit flat and volume-tier structures", () => {
  assert.match(source, /structure: "FLAT" \| "TIERED"/);
  assert.match(source, /Flat split — same amount for every ticket/);
  assert.match(source, /Volume tiers — amount changes after a threshold/);
});

test("flat agreements serialize as one unlimited tier", () => {
  assert.match(source, /isTiered[\s\S]*startsAtTicket: 1, endsAtTicket: null[\s\S]*tiers,/);
  assert.match(source, /Ringo share per ticket/);
});

test("the editor previews the resulting split and labels saved flat agreements", () => {
  assert.match(source, /PER-TICKET SPLIT PREVIEW/);
  assert.match(source, /Operator receives/);
  assert.match(source, /agreement\.tiers\.length === 1 \? "flat split"/);
  assert.match(source, /Every paid ticket/);
});

test("the editor warns when agreement and live checkout fees differ", () => {
  assert.match(source, /\[organization\.ticketFeeMinor, organization\.registeredTicketFeeMinor\]\.includes\(currencyInputCents\(ticketFeeAgreementDraft\.customerFee\)\)/);
  assert.match(source, /Customer-fee mismatch/);
  assert.match(source, /avoid settlement variances/);
  assert.match(source, /Use live checkout fee/);
  assert.match(source, /customerFee: \(organization\.ticketFeeMinor \/ 100\)\.toFixed\(2\)/);
});

test("the editor blocks agreement splits that exceed the customer fee", () => {
  assert.match(source, /function ticketFeeDraftOverallocates/);
  assert.match(source, /Split exceeds customer fee/);
  assert.match(source, /saving \|\| ticketFeeDraftOverallocates\(ticketFeeAgreementDraft\)/);
});

test("the editor identifies distinct guest and registered checkout fees", () => {
  assert.match(source, /registeredTicketFeeMinor !== organization\.ticketFeeMinor/);
  assert.match(source, /Two live checkout fees/);
  assert.match(source, /Use guest fee/);
  assert.match(source, /Use registered fee/);
});

test("new agreement versions start after the latest scheduled version", () => {
  assert.match(source, /function ticketFeeAgreementMinEffectiveDate/);
  assert.match(source, /nextDate\.setUTCDate\(nextDate\.getUTCDate\(\) \+ 1\)/);
  assert.match(source, /min=\{ticketFeeAgreementMinEffectiveDate\(organization\.ticketFeeAgreements\)\}/);
  assert.match(source, /Must follow the latest scheduled agreement version/);
});

test("commercial agreement calendar dates do not shift with browser timezone", () => {
  assert.match(source, /function utcCalendarDate/);
  assert.match(source, /timeZone: "UTC"/);
  assert.match(source, /utcCalendarDate\(agreement\.effectiveFrom\)/);
  assert.match(source, /utcCalendarDate\(organization\.ticketFeeSettlement\.periodFrom\)/);
});

test("agreement history distinguishes scheduled, current, and historical versions", () => {
  assert.match(source, /function ticketFeeAgreementVersionStatus/);
  assert.match(source, /return "Scheduled version"/);
  assert.match(source, /return "Historical version"/);
  assert.match(source, /return "Current version"/);
  assert.match(source, /versionStatus === "Scheduled version" \? "scheduled onward"/);
});

test("Master staff can cancel a scheduled agreement version", () => {
  assert.match(source, /async function cancelScheduledTicketFeeAgreement/);
  assert.match(source, /method: "DELETE"/);
  assert.match(source, /Cancel scheduled version/);
  assert.match(source, /versionStatus === "Scheduled version" && session\.user\.role !== "VIEWER"/);
});

test("settlement reconciliation distinguishes collected and expected fees", () => {
  assert.match(source, /Agreement expected fees/);
  assert.match(source, /platformShareCents \+ organization\.ticketFeeSettlement\.operatorShareCents/);
  assert.match(source, /Settlement needs reconciliation/);
  assert.match(source, /Review guest and registered-customer pricing, refunds, and the agreement basis/);
});

test("settlement variances require a durable reconciliation note", () => {
  assert.match(source, /Reconciliation note/);
  assert.match(source, /ticketFeeSettlement\.varianceCents !== 0 && !ticketFeeReconciliationNote\.trim\(\)/);
  assert.match(source, /notes: ticketFeeReconciliationNote\.trim\(\) \|\| null/);
  assert.match(apiSource, /settlement\.varianceCents !== 0 && !input\.notes\?\.trim\(\)/);
  assert.match(apiSource, /A reconciliation note is required when collected fees differ/);
});
