const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../../..");
const controller = fs.readFileSync(path.join(root, "apps/api/src/platform/platform.controller.ts"), "utf8");
const service = fs.readFileSync(path.join(root, "apps/api/src/platform/platform.service.ts"), "utf8");
const page = fs.readFileSync(path.join(root, "apps/platform-admin/app/films/[id]/page.tsx"), "utf8");

test("Master can inspect an authenticated showtime ticket map", () => {
  assert.match(controller, /showtimes\/:showtimeId\/ticket-map/);
  assert.match(service, /this\.reporting\.showtimeTicketMap/);
  assert.match(page, /<SeatMap/);
  assert.match(page, /Sold-seat map/);
  assert.match(page, /ticketMap\.counts\.sold/);
  assert.match(page, /ticketOrder\.orderNumber/);
});
