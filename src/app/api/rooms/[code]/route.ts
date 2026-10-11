import { NextResponse } from "next/server";
import { parseRoomCommand } from "@/lib/hanabi";
import {
  asApiError,
  getRoomView,
  leaveRoom,
  runRoomCommand,
} from "@/lib/room-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ code: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { code } = await context.params;
    const token = new URL(request.url).searchParams.get("token");
    return NextResponse.json(getRoomView(code, token));
  } catch (error) {
    const apiError = asApiError(error);
    return NextResponse.json(
      { error: apiError.message, code: apiError.code },
      { status: apiError.status },
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { code } = await context.params;
    const body = (await request.json()) as {
      token?: unknown;
      command?: unknown;
    };
    const command = parseRoomCommand(body.command);
    return NextResponse.json(runRoomCommand(code, body.token, command));
  } catch (error) {
    const apiError = asApiError(error);
    return NextResponse.json(
      { error: apiError.message, code: apiError.code },
      { status: apiError.status },
    );
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { code } = await context.params;
    const body = (await request.json()) as { token?: unknown };
    leaveRoom(code, body.token);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const apiError = asApiError(error);
    return NextResponse.json(
      { error: apiError.message, code: apiError.code },
      { status: apiError.status },
    );
  }
}
