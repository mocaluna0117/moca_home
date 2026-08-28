import type { ReceivedDraft } from "@/components/received-bonus-dialog";
import { draftReceivedBonuses } from "@/lib/bonus";
import type { OrderWithItems } from "@/lib/queries";

/**
 * Serializable props for the record dialog, derived from data the page
 * already holds: `existing` = rows already recorded, `predicted` = the
 * title-derived draft behind the 「予測を取り込む」 button.
 *
 * Server-side only (both callers are server components) — kept out of the
 * dialog itself so the order card and the detail section share one source.
 */
export function buildReceivedDrafts(order: OrderWithItems): {
  existing: ReceivedDraft[];
  predicted: ReceivedDraft[];
} {
  const existing: ReceivedDraft[] = order.receivedBonuses.map((r) => ({
    id: r.id,
    productId: r.productId,
    label: r.label,
    quantity: r.quantity,
    note: r.note,
    imageUrl: r.imageUrl,
  }));

  const predicted: ReceivedDraft[] = draftReceivedBonuses(
    order.items,
    order.bonuses,
  ).map((d) => ({
    productId: d.productId,
    label: d.label,
    quantity: d.quantity,
    note: null,
    imageUrl:
      d.productId !== null
        ? (order.items.find((i) => i.productId === d.productId)?.imageUrl ?? null)
        : null,
  }));

  return { existing, predicted };
}
