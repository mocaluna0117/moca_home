import { NextResponse } from "next/server";

import { getCatalogProduct } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** Full product row for the picker's preview panel. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const productId = Number.parseInt(id, 10);
  if (!Number.isInteger(productId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const item = getCatalogProduct(productId);
  if (!item) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ item }, { headers: { "Cache-Control": "no-store" } });
}
