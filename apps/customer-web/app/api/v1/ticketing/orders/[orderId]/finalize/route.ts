import { NextResponse } from "next/server";
import {
  checkoutRouteError,
  getTicketingService,
} from "../../../../../../lib/ticket-checkout";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  try {
    const { orderId } = await context.params;
    return NextResponse.json(await getTicketingService().finalizeOrder(orderId));
  } catch (error) {
    const known = checkoutRouteError(error);
    if (known) {
      return NextResponse.json(
        { code: known.code, message: known.message },
        { status: known.status },
      );
    }
    console.error(
      JSON.stringify({ event: "ticket_finalize.failed", error: String(error) }),
    );
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Ticket purchase could not be finalized." },
      { status: 500 },
    );
  }
}
