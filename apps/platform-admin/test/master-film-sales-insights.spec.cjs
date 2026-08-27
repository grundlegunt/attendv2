const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const platform = readFileSync(resolve(__dirname, "../../api/src/platform/platform.service.ts"), "utf8");
const filmPage = readFileSync(resolve(__dirname, "../app/films/[id]/page.tsx"), "utf8");

test("Master combines film ticket mix and purchase timing across operators", () => {
  assert.match(platform, /for \(const admission of report\.admissionTypes\)/);
  assert.match(platform, /for \(const channel of report\.salesChannels\)/);
  assert.match(platform, /for \(const bucket of report\.advanceSales\)/);
  assert.match(platform, /weightedLeadHours \+= bucket\.averageLeadHours \* bucket\.ticketsSold/);
});

test("film intelligence displays admission, channel, and advance-sales insights", () => {
  assert.match(filmPage, /How customers buy this film/);
  assert.match(filmPage, /Admission types/);
  assert.match(filmPage, /Sales channels/);
  assert.match(filmPage, /Advance purchase timing/);
  assert.match(filmPage, /row\.percentOfTickets/);
  assert.match(filmPage, /row\.averageLeadHours/);
});
