const { PrismaClient } = require("../../packages/database/node_modules/@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const location = await prisma.location.findFirstOrThrow({ where: { active: true } });
    const ticketType = await prisma.ticketType.findFirstOrThrow({ where: { locationId: location.id, active: true } });
    const candidates = await prisma.showtime.findMany({
      where: { onSale: true, startsAt: { gt: new Date() }, auditorium: { locationId: location.id }, showtimeSeats: { some: {} } },
      select: { id: true, auditoriumId: true },
      orderBy: { startsAt: "asc" },
    });
    const byAuditorium = new Map();
    for (const showtime of candidates) if (!byAuditorium.has(showtime.auditoriumId)) byAuditorium.set(showtime.auditoriumId, showtime.id);
    const showtimeIds = [...byAuditorium.values()].slice(0, 3);
    if (showtimeIds.length !== 3) throw new Error("The opening-night fixture requires future showtimes in three auditoriums.");
    process.stdout.write(`LOAD_TICKET_TYPE_ID=${ticketType.id}\nLOAD_SHOWTIME_IDS=${showtimeIds.join(",")}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
