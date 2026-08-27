import { NextResponse } from "next/server";

import { runCatalogSync, type CatalogProgress } from "@/lib/scraper/catalog";
import { SyncBusyError } from "@/lib/scraper/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A first sweep probes ~1,500 ids at 1 req/s. (Only enforced on serverless
// hosts — the CLI `npm run sync -- --catalog` is the recommended first run.)
export const maxDuration = 3600;

/** Streams newline-delimited JSON progress events, last line = summary. */
export async function POST() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));
      };

      try {
        const summary = await runCatalogSync((p: CatalogProgress) => send(p));
        send({ phase: "result", ok: true, summary });
      } catch (err) {
        send({
          phase: "result",
          ok: false,
          busy: err instanceof SyncBusyError,
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
