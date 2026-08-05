import { NextResponse } from "next/server";
import { prisma } from "@cinema/database";
import { dedupePublicShowtimes, startOfLocalDay, type PublicShowtime } from "@cinema/shared";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const locationId = new URL(request.url).searchParams.get("locationId");
  const location = locationId ? await prisma.location.findFirst({ where: { id: locationId, active: true } }) : await prisma.location.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } });
  if (!location) return NextResponse.json({ code: "NOT_FOUND", message: "Location not found." }, { status: 404 });
  const firstShowtimeToDisplay = startOfLocalDay(new Date(), location.timezone);
  const movies = await prisma.movie.findMany({
    where: { organizationId: location.organizationId, active: true, showtimes: { some: { onSale: true, startsAt: { gte: firstShowtimeToDisplay }, auditorium: { locationId: location.id } } } },
    include: { showtimes: { where: { onSale: true, startsAt: { gte: firstShowtimeToDisplay }, auditorium: { locationId: location.id } }, select: { id: true, startsAt: true, auditorium: { select: { id: true, name: true, capacity: true } }, priceTier: { select: { name: true, ticketPriceMinor: true, feeMinor: true, currency: true } } }, orderBy: { startsAt: "asc" } } },
    orderBy: { title: "asc" },
  });
  return NextResponse.json({
    location: { id: location.id, name: location.name, address: location.address, timezone: location.timezone },
    movies: movies.map((movie) => ({
      ...movie,
      showtimes: dedupePublicShowtimes(
        movie.showtimes.map((showtime) => ({
          ...showtime,
          startsAt: showtime.startsAt.toISOString(),
        })) as PublicShowtime[],
      ),
    })),
  });
}

// Production route for the Milestone 1 customer program.
