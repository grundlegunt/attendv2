import { NextResponse } from "next/server";
import { prisma } from "@cinema/database";
import { showtimePresentationSchema, type PublicFilmSeriesMovie } from "@cinema/shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const now = new Date();
  const locationId = new URL(request.url).searchParams.get("locationId");
  const location = locationId
    ? await prisma.location.findFirst({ where: { id: locationId, active: true } })
    : await prisma.location.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } });
  if (!location) return NextResponse.json({ code: "NOT_FOUND", message: "Location not found." }, { status: 404 });

  const series = await prisma.filmSeries.findMany({
    where: {
      organizationId: location.organizationId,
      active: true,
      showtimes: { some: { onSale: true, startsAt: { gte: now }, auditorium: { locationId: location.id, active: true } } },
    },
    include: {
      showtimes: {
        where: { onSale: true, startsAt: { gte: now }, auditorium: { locationId: location.id, active: true }, movie: { active: true } },
        select: {
          id: true,
          startsAt: true,
          presentation: true,
          format: true,
          movie: { select: { id: true, title: true, synopsis: true, runtimeMinutes: true, rating: true, posterUrl: true, director: true, starring: true, trailerUrl: true, releaseYear: true } },
          auditorium: { select: { id: true, name: true, capacity: true } },
          priceTier: { select: { name: true, ticketPriceMinor: true, feeMinor: true, currency: true } },
        },
        orderBy: { startsAt: "asc" },
      },
    },
  });

  const responseSeries = series.map((entry) => {
    const movies = new Map<string, PublicFilmSeriesMovie>();
    for (const showtime of entry.showtimes) {
      const movie = movies.get(showtime.movie.id) ?? { ...showtime.movie, showtimes: [] };
      movie.showtimes.push({
        id: showtime.id,
        startsAt: showtime.startsAt.toISOString(),
        presentation: showtimePresentationSchema.parse(showtime.presentation),
        format: showtime.format,
        filmSeries: { id: entry.id, name: entry.name },
        auditorium: showtime.auditorium,
        priceTier: showtime.priceTier,
      });
      movies.set(showtime.movie.id, movie);
    }
    return {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      artworkUrl: entry.artworkUrl,
      movies: Array.from(movies.values()),
      firstShowtimeAt: entry.showtimes[0]?.startsAt.getTime() ?? Infinity,
    };
  }).sort((a, b) => a.firstShowtimeAt - b.firstShowtimeAt)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      artworkUrl: entry.artworkUrl,
      movies: entry.movies,
    }));

  return NextResponse.json({
    location: { id: location.id, name: location.name, address: location.address, timezone: location.timezone },
    series: responseSeries,
  });
}
