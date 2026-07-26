import { NextResponse } from "next/server";
import { releaseHold, SeatHoldError } from "../../../../../../../lib/seat-holds";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ holdToken: string }> },
) {
  try {
    const { holdToken } = await context.params;
    const body = (await request.json()) as { holderKey?: string };
    return NextResponse.json(await releaseHold(holdToken, body.holderKey ?? ""));
  } catch (error) {
    if (error instanceof SeatHoldError) {
      return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
    }
    console.error(JSON.stringify({ event: "seat_release.failed", error: String(error) }));
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "The seat hold could not be released." },
      { status: 500 },
    );
  }
}
