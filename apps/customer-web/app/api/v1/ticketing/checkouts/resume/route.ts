import { NextResponse } from "next/server";
import { resumeTicketCheckoutRequestSchema } from "@cinema/shared";
import {
  checkoutRouteError,
  getTicketingService,
} from "../../../../../lib/ticket-checkout";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = resumeTicketCheckoutRequestSchema.parse(await request.json());
    const idempotencyKey = request.headers.get("idempotency-key") ?? "";
    return NextResponse.json(
      await getTicketingService().resumeCheckout({
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
      JSON.stringify({ event: "ticket_checkout_resume.failed", error: String(error) }),
    );
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Checkout could not be resumed." },
      { status: 500 },
    );
  }
}
