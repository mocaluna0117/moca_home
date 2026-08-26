import { NextResponse } from "next/server";

import { SyncBusyError, runSync, type SyncProgress } from "@/lib/scraper/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A first sync walks ~120 pages at 1 req/s.
export const maxDuration = 300;

/** Streams newline-delimited JSON progress events, last line = summary. */
export async function POST() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));
      };

      try {
        const summary = await runSync((p: SyncProgress) => send(p));
        send({ phase: "result", ok: true, summary });
      } catch (err) {
        const busy = err instanceof SyncBusyError;
        send({
          phase: "result",
          ok: false,
          busy,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
    },
  });
}
