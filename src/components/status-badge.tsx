import { Badge } from "@/components/ui/badge";

/** The site's 注文状況 labels are free text; map the known ones, pass through the rest. */
export function StatusBadge({ status }: { status: string }) {
  const variant =
    status.includes("キャンセル") || status.includes("取消")
      ? "destructive"
      : status.includes("発送") || status.includes("完了")
        ? "default"
        : status.includes("受付") || status.includes("対応")
          ? "secondary"
          : "outline";

  return (
    <Badge variant={variant} className="shrink-0 font-normal">
      {status}
    </Badge>
  );
}
