import { asApiError, subscribeToRoom } from "@/lib/room-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ code: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { code } = await context.params;
  const token = new URL(request.url).searchParams.get("token");
  const encoder = new TextEncoder();
  let cleanup: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      try {
        const send = (view: unknown) => {
          if (closed) return;
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(view)}\n\n`),
          );
        };
        cleanup = subscribeToRoom(code, token, send);
        heartbeat = setInterval(() => {
          if (!closed) controller.enqueue(encoder.encode(": heartbeat\n\n"));
        }, 20_000);

        const close = () => {
          if (closed) return;
          closed = true;
          if (heartbeat) clearInterval(heartbeat);
          cleanup?.();
          try {
            controller.close();
          } catch {
            // The browser may have already closed the stream.
          }
        };
        request.signal.addEventListener("abort", close, { once: true });
      } catch (error) {
        const apiError = asApiError(error);
        controller.enqueue(
          encoder.encode(
            `event: room-error\ndata: ${JSON.stringify({
              error: apiError.message,
              code: apiError.code,
            })}\n\n`,
          ),
        );
        controller.close();
      }
    },
    cancel() {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
