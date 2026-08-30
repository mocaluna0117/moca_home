"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { ProductSearchDialog } from "@/components/product-search-dialog";
import { Button } from "@/components/ui/button";

/**
 * 一覧ページの検索。以前はヘッダー行に検索欄を常設して打つそばから
 * 一覧を絞り込んでいたが、モーダルに移した。
 *
 * モーダルにしたことで、絞り込みだけでなく **買ったことのない商品にも
 * 直接飛べる** ようになっている（一覧は購入履歴しか持たないが、モーダルの
 * 候補は全カタログ 約1,120件）。
 * - 候補を選ぶ → その商品ページへ
 * - 「この語で一覧を絞り込む」→ 従来どおり ?q= を付ける
 *
 * 適用中の絞り込みはボタンの隣にチップで出す。モーダルを閉じると
 * 検索語が見えなくなるため、何で絞られているかを画面に残しておく必要がある。
 */
export function SearchLauncher() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const q = searchParams.get("q")?.trim() ?? "";

  function setQuery(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("q", next);
    else params.delete("q");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div className="flex items-center gap-2">
      <ProductSearchDialog
        title="商品を検索"
        description="20&20 の全商品から探せます。選ぶとその商品のページを開きます。"
        trigger={
          <>
            <Search aria-hidden="true" />
            検索
          </>
        }
        onSelect={(item) => router.push(`/products/${item.id}`)}
        renderFooter={(query, close) =>
          query === "" ? null : (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setQuery(query);
                close();
              }}
            >
              「{query}」でこの一覧を絞り込む
            </Button>
          )
        }
      />

      {q !== "" && (
        <span className="inline-flex items-center gap-1 rounded-md border py-1 pr-1 pl-2.5 text-sm">
          <span className="max-w-[10rem] truncate">{q}</span>
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="絞り込みを解除"
            className="rounded-sm p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </span>
      )}
    </div>
  );
}
