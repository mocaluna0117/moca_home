import { FileQuestion } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <FileQuestion className="size-10 text-muted-foreground" />
      <h1 className="font-heading text-lg">見つかりませんでした</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        その注文または商品は取得済みのデータに含まれていません。
        新しい注文の場合は「同期」を実行してください。
      </p>
      <Link
        href="/orders"
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        購入履歴に戻る
      </Link>
    </div>
  );
}
