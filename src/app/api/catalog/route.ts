import { NextResponse } from "next/server";

import { getCatalogProducts } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** Picker source for the received-bonus dialog (lazy-fetched on open). */
export async function GET() {
  return NextResponse.json(
    { items: await getCatalogProducts() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
