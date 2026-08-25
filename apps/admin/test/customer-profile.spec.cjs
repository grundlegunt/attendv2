const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const profile = readFileSync(resolve(__dirname, "../app/customers/[id]/page.tsx"), "utf8");
const search = readFileSync(resolve(__dirname, "../app/search/page.tsx"), "utf8");
const managementControls = readFileSync(resolve(__dirname, "../app/management-controls.tsx"), "utf8");
const refundService = readFileSync(resolve(__dirname, "../../api/src/management/management-refund.service.ts"), "utf8");
const managementService = readFileSync(resolve(__dirname, "../../api/src/management/management.service.ts"), "utf8");

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

test("customer profiles reuse authenticated history, pagination, and export endpoints", () => {
  assert.match(profile, /apiFetch<Customer>\(`\/management\/customers\/\$\{id\}`/);
  assert.match(profile, /ticketOffset/);
  assert.match(profile, /diningOffset/);
  assert.match(profile, /apiDownload\(`\/management\/customers\/\$\{id\}\/history\.csv`/);
  for (const label of ["Customer type", "Membership", "Ticket orders", "Ticket spend", "Dining visits", "Ticket order history", "Food &amp; drink history"]) assert.ok(profile.includes(label));
});

test("refund workflows preserve authoritative customer IDs and link to profiles", () => {
  assert.match(refundService, /customer: \{ select: \{ id: true, name: true, email: true \} \}/);
  assert.match(refundService, /primaryCustomer: \{ select: \{ id: true, name: true, email: true \} \}/);
  assert.match(managementControls, /order\.customer\.id/);
  assert.match(managementControls, /tab\.primaryCustomer\.id/);
  assert.ok(managementControls.match(/Open customer/g).length >= 4);
});
