import { NextResponse } from "next/server";
import {
  checkoutRouteError,
  getTicketingService,
} from "../../../../../lib/ticket-checkout";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const rawBody = Buffer.from(await request.arrayBuffer());
    const signature = request.headers.get("stripe-signature") ?? "";
    return NextResponse.json(
      await getTicketingService().verifyAndProcessWebhook(rawBody, signature),
    );
  } catch (error) {
    const known = checkoutRouteError(error);
    if (known) {
      return NextResponse.json(
        { code: known.code, message: known.message },
        { status: known.status },
      );
    }
    return NextResponse.json(
      { code: "FORBIDDEN", message: "Webhook signature is invalid." },
      { status: 403 },
    );
  }
}
