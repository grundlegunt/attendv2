import { NextResponse } from "next/server";
import { holdSeats, SeatHoldError } from "../../../../../../lib/seat-holds";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ showtimeId: string }> },
) {
  try {
    const { showtimeId } = await context.params;
    const body = (await request.json()) as { seatIds?: string[]; holderKey?: string };
    const holds = await holdSeats(showtimeId, body.seatIds ?? [], body.holderKey ?? "");
    return NextResponse.json({
      holds: holds.map((hold) => ({
        holdToken: hold.holdToken,
        expiresAt: hold.expiresAt.toISOString(),
      })),
    });
  } catch (error) {
    if (error instanceof SeatHoldError) {
      return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
    }
    console.error(JSON.stringify({ event: "seat_hold.failed", error: String(error) }));
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "The seats could not be held." },
      { status: 500 },
    );
  }
}
