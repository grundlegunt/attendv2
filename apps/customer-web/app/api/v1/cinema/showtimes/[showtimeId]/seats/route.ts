import { NextResponse } from "next/server";
import { getSeatAvailability, SeatHoldError } from "../../../../../../../lib/seat-holds";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ showtimeId: string }> },
) {
  try {
    const { showtimeId } = await context.params;
    const holderKey = new URL(request.url).searchParams.get("holderKey") ?? undefined;
    return NextResponse.json(await getSeatAvailability(showtimeId, holderKey));
  } catch (error) {
    if (error instanceof SeatHoldError) {
      return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
    }
    console.error(JSON.stringify({ event: "seat_availability.failed", error: String(error) }));
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Seat availability is temporarily unavailable." },
      { status: 500 },
    );
  }
}
