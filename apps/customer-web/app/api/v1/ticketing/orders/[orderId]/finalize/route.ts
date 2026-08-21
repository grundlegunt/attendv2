import { NextResponse } from "next/server";
import { finalizeTicketOrderRequestSchema } from "@cinema/shared";
import {
  checkoutRouteError,
  getTicketingService,
} from "../../../../../../lib/ticket-checkout";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  try {
    const { orderId } = await context.params;
    const body = finalizeTicketOrderRequestSchema.parse(await request.json());
    return NextResponse.json(await getTicketingService().finalizeGuestOrder(orderId, body.holderKey));
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
