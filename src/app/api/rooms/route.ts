import { NextResponse } from "next/server";
import { asApiError, createRoom, joinRoom } from "@/lib/room-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: unknown;
      name?: unknown;
      code?: unknown;
    };

    if (body.action === "create") {
      return NextResponse.json(createRoom(body.name));
    }
    if (body.action === "join") {
      return NextResponse.json(joinRoom(body.code, body.name));
    }
    return NextResponse.json(
      { error: "未知的房间操作", code: "UNKNOWN_ACTION" },
      { status: 400 },
    );
  } catch (error) {
    const apiError = asApiError(error);
    return NextResponse.json(
      { error: apiError.message, code: apiError.code },
      { status: apiError.status },
    );
  }
}
