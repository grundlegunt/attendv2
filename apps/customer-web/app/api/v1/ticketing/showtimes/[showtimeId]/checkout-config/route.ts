import { NextResponse } from "next/server";
import { prisma } from "@cinema/database";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ showtimeId: string }> },
) {
  const { showtimeId } = await context.params;
  const showtime = await prisma.showtime.findFirst({
    where: { id: showtimeId, onSale: true, startsAt: { gt: new Date() } },
    select: {
      id: true,
      auditorium: {
        select: {
          location: {
            select: {
              id: true,
              currency: true,
              organization: {
                select: { stripeConnectedAccountId: true },
              },
              ticketTypes: {
                where: { active: true },
                select: { id: true, name: true },
                orderBy: { name: "asc" },
              },
            },
          },
        },
      },
    },
  });
  if (!showtime) {
    return NextResponse.json(
      { code: "NOT_FOUND", message: "Showtime is not available." },
      { status: 404 },
    );
  }
  const location = showtime.auditorium.location;
  return NextResponse.json({
    showtimeId,
    locationId: location.id,
    currency: location.currency,
    ticketTypes: location.ticketTypes,
    payment: {
      ready: Boolean(
          process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY &&
          process.env.STRIPE_SECRET_KEY &&
          process.env.STRIPE_WEBHOOK_SECRET &&
          location.organization.stripeConnectedAccountId,
      ),
      publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null,
      connectedAccountId: location.organization.stripeConnectedAccountId,
    },
  });
}
