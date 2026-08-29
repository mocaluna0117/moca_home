import { NextResponse } from "next/server";

import { runCatalogSync, type CatalogProgress } from "@/lib/scraper/catalog";
import { SyncBusyError } from "@/lib/scraper/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The sweep never actually runs here — on Vercel this route returns 501 and
// the real run is the CLI (`npm run sync:prod -- --catalog`). Keep the value
// inside the Hobby plan's 1–300s ceiling so the build is accepted.
export const maxDuration = 60;

/** Streams newline-delimited JSON progress events, last line = summary. */
export async function POST() {
  // A full sweep is ~30 min of 1 req/s probing — beyond every serverless
  // limit. On Vercel this must be run from the CLI against the same database.
  if (process.env.VERCEL) {
    return NextResponse.json(
      {
        error:
          "カタログ同期は実行時間が長いためデプロイ環境では実行できません。手元で `npm run sync -- --catalog` を実行してください。",
      },
      { status: 501 },
    );
  }

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
