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
