import { NextResponse } from "next/server";
import { prisma } from "@cinema/database";
import { loadStripeEnv } from "@cinema/config/env";

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
      priceTier: { select: { ticketPriceMinor: true } },
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
                select: { id: true, name: true, priceAdjustmentMinor: true },
                orderBy: { name: "asc" },
              },
              menuCategories: {
                where: { active: true },
                select: {
                  id: true,
                  name: true,
                  items: {
                    where: { active: true, is86d: false },
                    select: {
                      id: true,
                      name: true,
                      description: true,
                      imageUrl: true,
                      priceCents: true,
                      chargeCategory: true,
                      isVegan: true,
                      isGlutenFree: true,
                      modifierGroups: {
                        where: { active: true },
                        select: {
                          id: true,
                          name: true,
                          selectionType: true,
                          required: true,
                          minSelections: true,
                          maxSelections: true,
                          modifiers: {
                            where: { active: true },
                            select: {
                              id: true,
                              name: true,
                              priceDeltaCents: true,
                            },
                            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
                          },
                        },
                        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
                      },
                    },
                    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
                  },
                },
                orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
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
  let stripe: ReturnType<typeof loadStripeEnv> | null = null;
  try {
    stripe = loadStripeEnv();
  } catch {
    // Missing or invalid payment configuration is reported as not ready below.
  }
  return NextResponse.json({
    showtimeId,
    locationId: location.id,
    currency: location.currency,
    baseTicketPriceCents: showtime.priceTier.ticketPriceMinor,
    ticketTypes: location.ticketTypes,
    orderAhead: {
      available: location.menuCategories.some((category) => category.items.length > 0),
      categories: location.menuCategories.filter((category) => category.items.length > 0),
    },
    payment: {
      ready: Boolean(
          stripe &&
          location.organization.stripeConnectedAccountId,
      ),
      publishableKey: stripe?.STRIPE_PUBLISHABLE_KEY ?? null,
      connectedAccountId: location.organization.stripeConnectedAccountId,
    },
  });
}
