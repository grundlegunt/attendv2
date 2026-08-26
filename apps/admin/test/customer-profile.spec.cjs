const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const profile = readFileSync(resolve(__dirname, "../app/customers/[id]/page.tsx"), "utf8");
const search = readFileSync(resolve(__dirname, "../app/search/page.tsx"), "utf8");
const managementControls = readFileSync(resolve(__dirname, "../app/management-controls.tsx"), "utf8");
const refundService = readFileSync(resolve(__dirname, "../../api/src/management/management-refund.service.ts"), "utf8");
const managementService = readFileSync(resolve(__dirname, "../../api/src/management/management.service.ts"), "utf8");
const attention = readFileSync(resolve(__dirname, "../app/attention/page.tsx"), "utf8");
const donationCheckoutService = readFileSync(resolve(__dirname, "../../api/src/donation-checkouts/donation-checkout.service.ts"), "utf8");

test("customer search links to durable customer profiles", () => {
  assert.match(search, /href=\{`\/customers\/\$\{encodeURIComponent\(customer\.id\)\}`\}/);
  assert.match(search, /Open profile/);
});

test("registered order search results link to their customer profile", () => {
  assert.match(managementService, /customer: \{ select: \{ id: true, name: true, email: true \} \}/);
  assert.match(search, /order\.customer\.id/);
  assert.match(search, /Open customer/);
});

test("exact registered ticket results link to their customer profile", () => {
  assert.match(managementService, /ticketOrder: \{[\s\S]*customer: \{ select: \{ id: true \} \}/);
  assert.match(search, /ticket\.ticketOrder\.customer\.id/);
});

test("customer-linked attention items open durable customer profiles", () => {
  assert.match(attention, /order\.customer\.id/);
  assert.match(attention, /tab\.primaryCustomer\.id/);
  assert.ok(attention.match(/Open customer/g).length >= 2);
});

test("failed refunds retain their originating customer profile", () => {
  assert.match(managementService, /ticketOrder: \{ select: \{ orderNumber: true, customer: \{ select: \{ id: true \} \}/);
  assert.match(managementService, /restaurantTab: \{ select: \{ id: true, label: true, primaryCustomer: \{ select: \{ id: true \} \}/);
  assert.match(attention, /failedRefundCustomerId\(refund\)/);
});

test("customer profiles reuse authenticated history, pagination, and export endpoints", () => {
  assert.match(profile, /apiFetch<Customer>\(`\/management\/customers\/\$\{id\}`/);
  assert.match(profile, /ticketOffset/);
  assert.match(profile, /diningOffset/);
  assert.match(profile, /donationOffset/);
  assert.match(profile, /apiDownload\(`\/management\/customers\/\$\{id\}\/history\.csv`/);
  for (const label of ["Customer type", "Membership", "Ticket orders", "Ticket spend", "Dining visits", "Giving", "Giving history", "Repeat donor", "One-time donor", "Ticket order history", "Food &amp; drink history", "Donation history"]) assert.ok(profile.includes(label));
  assert.match(profile, /Expires \$\{date\(customer\.membership\.expiresAt\)\}/);
  assert.match(profile, /No expiration/);
});

test("registered donors use the existing customer profile and retain location-scoped giving history", () => {
  const donations = readFileSync(resolve(__dirname, "../app/donations/page.tsx"), "utf8");
  const campaign = readFileSync(resolve(__dirname, "../app/donations/[id]/page.tsx"), "utf8");
  assert.match(donations, /href=\{`\/customers\/\$\{donation\.customer\.id\}`\}/);
  assert.match(campaign, /href=\{`\/customers\/\$\{donation\.customer\.id\}`\}/);
  assert.match(managementService, /donations: \{\s*where: \{ locationId \}/);
  assert.match(managementService, /prisma\.donation\.aggregate\(\{ where: \{ customerId, locationId, status: "SETTLED" \}/);
  assert.match(managementService, /const donationRows = customer\.donations\.map/);
});

test("settled online donations attach to an existing exact-email customer identity", () => {
  assert.match(donationCheckoutService, /tx\.customer\.findFirst\(\{\s*where: \{ email: checkout\.donorEmail, deletedAt: null \}/);
  assert.match(donationCheckoutService, /customerId: customer\?\.id/);
  assert.match(donationCheckoutService, /customerId: customer\?\.id \?\? null/);
});

test("refund workflows preserve authoritative customer IDs and link to profiles", () => {
  assert.match(refundService, /customer: \{ select: \{ id: true, name: true, email: true \} \}/);
  assert.match(refundService, /primaryCustomer: \{ select: \{ id: true, name: true, email: true \} \}/);
  assert.match(managementControls, /order\.customer\.id/);
  assert.match(managementControls, /tab\.primaryCustomer\.id/);
  assert.ok(managementControls.match(/Open customer/g).length >= 4);
});
