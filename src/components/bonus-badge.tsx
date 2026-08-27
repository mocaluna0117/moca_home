import { Gift } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type {
  BonusRule,
  ItemBonusResult,
  OrderBonusResult,
} from "@/lib/bonus";

/**
 * Display policy: a per-line badge appears ONLY when that line alone crossed
 * its threshold; pool-triggered bonuses are surfaced once at order level so a
 * shared freebie is never double-counted visually.
 * Variants: secondary = earned bonus / outline = passive rule info /
 * muted text = hints. `default`/`destructive` stay reserved for StatusBadge.
 */
export function BonusBadge({ item }: { item: ItemBonusResult }) {
  if (!item.activated || !item.rule) return null;
  const label =
    item.rule.kind === "gift"
      ? `${item.giftLabel ?? "ギフト"}プレゼント`
      : item.rule.kind === "included"
        ? "おまけ同梱"
        : `おまけ +${item.bonusCount}コ`;
  return (
    <Badge
      variant="secondary"
      className="shrink-0 font-normal"
      title={item.rule.matchedText}
    >
      <Gift aria-hidden="true" />
      {label}
    </Badge>
  );
}

/** Compact rule label for ProductCard overlays (≦7 chars). */
export function formatRuleShort(rule: BonusRule): string {
  switch (rule.kind) {
    case "same-plus":
      return `${rule.threshold}${rule.unit}で+${rule.bonusCount}`;
    case "gift":
      return `${rule.threshold}${rule.unit}でご飯`;
    case "included":
      return "おまけ同梱";
  }
}

/** Full rule sentence for the product detail page. */
export function formatRuleLong(rule: BonusRule): string {
  switch (rule.kind) {
    case "same-plus":
      return `${rule.threshold}${rule.unit}購入ごとに +${rule.bonusCount}コプレゼント`;
    case "gift":
      return `${rule.threshold}${rule.unit}購入で${rule.gift.label}プレゼント`;
    case "included":
      return `おまけ${rule.includedCount}コ同梱`;
  }
}

/** 「おまけ +2コ ・ 手作りご飯 +1セット」 for card headers / totals dl. */
export function formatBonusSummary(bonuses: OrderBonusResult): string {
  const parts: string[] = [];
  if (bonuses.totalBonusCount > 0) parts.push(`おまけ +${bonuses.totalBonusCount}コ`);
  for (const g of bonuses.gifts) {
    parts.push(`${g.label} +${g.count}${g.unit ?? ""}`);
  }
  return parts.join(" ・ ");
}

/** One-word cell for the product-detail history table. */
export function formatHistoryBonus(bonus: ItemBonusResult | null): string {
  if (!bonus || !bonus.activated) return "—";
  if (bonus.rule?.kind === "gift") {
    return bonus.pooled ? "合算ご飯" : "ご飯";
  }
  if (bonus.rule?.kind === "included") return "同梱";
  return bonus.pooled ? `合算+${bonus.bonusCount}` : `+${bonus.bonusCount}コ`;
}
