import { randomUUID } from "node:crypto";
import { Prisma, prisma } from "@cinema/database";

export class SeatHoldError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export async function getSeatAvailability(showtimeId: string, holderKey?: string) {
  const now = new Date();
  await prisma.seatHold.updateMany({
    where: { releasedAt: null, expiresAt: { lte: now }, showtimeSeat: { showtimeId } },
    data: { releasedAt: now },
  });
  const showtime = await prisma.showtime.findFirst({
    where: { id: showtimeId, onSale: true },
    include: {
      movie: true,
      auditorium: true,
      priceTier: true,
      showtimeSeats: {
        include: {
          seat: true,
          holds: {
            where: { releasedAt: null, expiresAt: { gt: now } },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          tickets: {
            where: { status: { notIn: ["REFUNDED", "CANCELED"] } },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });
  if (!showtime) throw new SeatHoldError("Showtime not found.", 404, "NOT_FOUND");
  return {
    showtime: {
      id: showtime.id,
      startsAt: showtime.startsAt.toISOString(),
      movie: { id: showtime.movie.id, title: showtime.movie.title },
      auditorium: {
        id: showtime.auditorium.id,
        name: showtime.auditorium.name,
        capacity: showtime.auditorium.capacity,
      },
      priceTier: {
        ticketPriceMinor: showtime.priceTier.ticketPriceMinor,
        feeMinor: showtime.priceTier.feeMinor,
        currency: showtime.priceTier.currency,
      },
    },
    serverTime: now.toISOString(),
    holdDurationSeconds: 300,
    seats: showtime.showtimeSeats
      .sort((a, b) => a.seat.y - b.seat.y || a.seat.x - b.seat.x)
      .map((inventory) => {
        const hold = inventory.holds[0];
        const heldByMe = Boolean(hold && holderKey && hold.holderKey === holderKey);
        return {
          id: inventory.seat.id,
          inventoryId: inventory.id,
          label: inventory.seat.label,
          rowLabel: inventory.seat.rowLabel,
          number: inventory.seat.number,
          x: inventory.seat.x,
          y: inventory.seat.y,
          type: inventory.seat.type,
          tableGroupId: inventory.seat.tableGroupId,
          tablePosition: inventory.seat.tablePosition,
          state: inventory.blockedAt
            ? "BLOCKED"
            : inventory.tickets.length
              ? "SOLD"
              : hold
                ? "HELD"
                : "AVAILABLE",
          heldByMe,
          holdToken: heldByMe ? hold?.holdToken : undefined,
          expiresAt: heldByMe ? hold?.expiresAt.toISOString() : undefined,
        };
      }),
  };
}

export async function holdSeats(showtimeId: string, seatIds: string[], holderKey: string) {
  const uniqueSeatIds = [...new Set(seatIds)].sort();
  if (holderKey.length < 16 || holderKey.length > 200) {
    throw new SeatHoldError("A valid checkout session is required.", 400, "VALIDATION_FAILED");
  }
  if (!uniqueSeatIds.length || uniqueSeatIds.length > 10) {
    throw new SeatHoldError("Select between 1 and 10 seats.", 400, "VALIDATION_FAILED");
  }

  return prisma.$transaction(
    async (tx) => {
      const showtime = await tx.showtime.findFirst({
        where: { id: showtimeId, onSale: true, startsAt: { gt: new Date() } },
        select: { id: true },
      });
      if (!showtime) throw new SeatHoldError("Showtime is not available.", 404, "NOT_FOUND");

      const inventory = await tx.$queryRaw<Array<{ id: string; seatId: string; blockedAt: Date | null }>>(
        Prisma.sql`
          SELECT "id", "seatId", "blockedAt"
          FROM "showtime_seats"
          WHERE "showtimeId" = ${showtimeId}
            AND "seatId" IN (${Prisma.join(uniqueSeatIds)})
          ORDER BY "seatId"
          FOR UPDATE
        `,
      );
      if (inventory.length !== uniqueSeatIds.length) {
        throw new SeatHoldError("One or more seats do not exist.", 404, "NOT_FOUND");
      }
      if (inventory.some((seat) => seat.blockedAt)) {
        throw new SeatHoldError("One or more seats are blocked.", 409, "SEAT_UNAVAILABLE");
      }

      const now = new Date();
      const inventoryIds = inventory.map((seat) => seat.id);
      const sold = await tx.ticket.findFirst({
        where: {
          showtimeSeatId: { in: inventoryIds },
          status: { notIn: ["REFUNDED", "CANCELED"] },
        },
      });
      if (sold) {
        throw new SeatHoldError(
          "One or more seats have already been sold.",
          409,
          "SEAT_UNAVAILABLE",
        );
      }
      await tx.seatHold.updateMany({
        where: { showtimeSeatId: { in: inventoryIds }, releasedAt: null, expiresAt: { lte: now } },
        data: { releasedAt: now },
      });
      const active = await tx.seatHold.findMany({
        where: { showtimeSeatId: { in: inventoryIds }, releasedAt: null, expiresAt: { gt: now } },
      });
      const mine = active.filter((hold) => hold.holderKey === holderKey);
      if (active.length && mine.length !== uniqueSeatIds.length) {
        throw new SeatHoldError(
          "One or more seats were just held by another guest.",
          409,
          "SEAT_UNAVAILABLE",
        );
      }
      if (mine.length === uniqueSeatIds.length) return mine;

      const expiresAt = new Date(now.getTime() + 5 * 60_000);
      await tx.seatHold.createMany({
        data: inventoryIds.map((showtimeSeatId) => ({
          showtimeSeatId,
          holderKey,
          holdToken: randomUUID(),
          expiresAt,
        })),
      });
      return tx.seatHold.findMany({
        where: { showtimeSeatId: { in: inventoryIds }, holderKey, releasedAt: null, expiresAt },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}

export async function releaseHold(holdToken: string, holderKey: string) {
  const result = await prisma.seatHold.updateMany({
    where: { holdToken, holderKey, releasedAt: null },
    data: { releasedAt: new Date() },
  });
  if (!result.count) throw new SeatHoldError("Active seat hold not found.", 404, "NOT_FOUND");
  return { released: true };
}
