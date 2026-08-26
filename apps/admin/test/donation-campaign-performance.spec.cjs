const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");

const directory = readFileSync(resolve(__dirname, "../app/donations/page.tsx"), "utf8");
const detail = readFileSync(resolve(__dirname, "../app/donations/[id]/page.tsx"), "utf8");
const service = readFileSync(resolve(__dirname, "../../api/src/management/management.service.ts"), "utf8");

test("donation campaigns link to exact period performance", () => {
  assert.match(directory, /href=\{`\/donations\/\$\{campaign\.id\}`\}/);
  assert.match(detail, /management\/donation-campaigns\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(detail, /raisedAmountCents/);
  assert.match(detail, /averageContributionCents/);
  assert.match(detail, /refundedAmountCents/);
  assert.match(detail, /parameters\.set\("campaignId", id\)/);
});

test("campaign performance is organization scoped and uses database aggregates", () => {
  assert.match(service, /id: campaignId, organizationId: location\.organizationId/);
  assert.match(service, /prisma\.donation\.aggregate\(\{ where: \{ \.\.\.period, status: "SETTLED" \}/);
  assert.match(service, /prisma\.donation\.aggregate\(\{ where: \{ \.\.\.period, status: "REFUNDED" \}/);
  assert.match(service, /take: 250/);
});

test("campaign details use stable retries and cinema-local inclusive dates", () => {
  assert.match(detail, /updateRequestId\.current \?\?= crypto\.randomUUID\(\)/);
  assert.match(detail, /if \(!data \|\| mutationPending\.current\) return; mutationPending\.current = true/);
  assert.match(detail, /finally \{ mutationPending\.current = false; setUpdating\(false\); \}/);
  assert.match(detail, /inclusiveReportRange\(startsOn, startsOn, data\.location\.timezone\)\.from/);
  assert.match(detail, /inclusiveDateCutoff\(endsOn, data\.location\.timezone\)/);
  assert.match(detail, /changeDraft\(setName/);
  assert.match(detail, /changeDraft\(setEndsOn/);
  assert.match(detail, /The end date includes the full selected day\./);
});
