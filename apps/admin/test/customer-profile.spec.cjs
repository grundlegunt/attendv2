const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const profile = readFileSync(resolve(__dirname, "../app/customers/[id]/page.tsx"), "utf8");
const search = readFileSync(resolve(__dirname, "../app/search/page.tsx"), "utf8");

test("customer search links to durable customer profiles", () => {
  assert.match(search, /href=\{`\/customers\/\$\{encodeURIComponent\(customer\.id\)\}`\}/);
  assert.match(search, /Open profile/);
});

test("customer profiles reuse authenticated history, pagination, and export endpoints", () => {
  assert.match(profile, /apiFetch<Customer>\(`\/management\/customers\/\$\{id\}`/);
  assert.match(profile, /ticketOffset/);
  assert.match(profile, /diningOffset/);
  assert.match(profile, /apiDownload\(`\/management\/customers\/\$\{id\}\/history\.csv`/);
  for (const label of ["Customer type", "Membership", "Ticket orders", "Ticket spend", "Dining visits", "Ticket order history", "Food &amp; drink history"]) assert.ok(profile.includes(label));
});
