import { NextResponse } from "next/server";
import { createTicketCheckoutRequestSchema } from "@cinema/shared";
import {
  checkoutRouteError,
  getTicketingService,
} from "../../../../lib/ticket-checkout";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = createTicketCheckoutRequestSchema.parse(await request.json());
    const idempotencyKey = request.headers.get("idempotency-key") ?? "";
    return NextResponse.json(
      await getTicketingService().createCheckout({
        ...body,
        checkoutIdempotencyKey: idempotencyKey,
      }),
    );
  } catch (error) {
    const known = checkoutRouteError(error);
    if (known) {
      return NextResponse.json(
        { code: known.code, message: known.message },
        { status: known.status },
      );
    }
    console.error(
      JSON.stringify({ event: "ticket_checkout.failed", error: String(error) }),
    );
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Checkout could not be started." },
      { status: 500 },
    );
  }
}
