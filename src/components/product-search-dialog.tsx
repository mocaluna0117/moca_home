"use client";

import { Search } from "lucide-react";
import { useState } from "react";

import {
  CatalogPicker,
  ProductPreview,
  useCatalog,
  useFavoriteIds,
  type CatalogItem,
} from "@/components/catalog-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * 商品を検索して1つ選ぶための専用モーダル。
 *
 * 以前は記録ダイアログの中に検索欄と候補リストを直接展開していた。1行ごとに
 * 50件のリストが差し込まれてダイアログが縦に伸び、どの行を編集しているのか
 * 見失いやすかったので、選ぶあいだだけ前面を占有する形に変えた。
 *
 * 記録ダイアログの上に重なる入れ子モーダルになる。Base UI の Dialog は
 * それぞれが独自の Portal と backdrop を持ち、後から開いたものが前面に出て
 * Esc も最前面から順に閉じるので、親を巻き込まずに閉じられる。
 */
export function ProductSearchDialog({
  onSelect,
  title = "商品を選ぶ",
  description = "商品名で絞り込めます。お気に入りは先頭に表示されます。",
  trigger,
  triggerVariant = "outline",
  triggerClassName,
  /** 親ダイアログが開いた時点でカタログを温めておく（初回の待ちを消す） */
  prefetch = false,
  /** 記録ダイアログの上に開く場合。親を暗く沈ませて2枚だと分かるようにする */
  nested = false,
  /** 検索語を使った追加の操作（例: 一覧をこの語で絞り込む） */
  renderFooter,
}: {
  onSelect: (item: CatalogItem) => void;
  title?: string;
  description?: string;
  trigger?: React.ReactNode;
  triggerVariant?: "default" | "outline" | "ghost";
  triggerClassName?: string;
  prefetch?: boolean;
  nested?: boolean;
  renderFooter?: (query: string, close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [previewId, setPreviewId] = useState<number | null>(null);
  const catalog = useCatalog(open || prefetch);
  const favoriteIds = useFavoriteIds(open);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    setPreviewId(null);
    if (next) setQuery("");
  }

  function choose(item: CatalogItem) {
    onSelect(item);
    setOpen(false);
    setPreviewId(null);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant={triggerVariant} size="sm" className={triggerClassName}>
            {trigger ?? (
              <>
                <Search aria-hidden="true" />
                商品を検索
              </>
            )}
          </Button>
        }
      />
      <DialogContent
        className="sm:max-w-4xl"
        // 親ダイアログと子モーダルはどちらも 4xl なので、重なると1枚の
        // パネルに見えてしまう（✕ が縦に2つ並ぶ）。子のときだけ背景を
        // 濃くして、親が後ろにあることを見た目で分からせる。
        // Base UI は入れ子の背景を描かないので forceRender が要る。
        overlayProps={
          nested
            ? {
                forceRender: true,
                className:
                  "bg-black/45 supports-backdrop-filter:backdrop-blur-sm",
              }
            : undefined
        }
      >
        {previewId !== null && (
          <ProductPreview
            key={previewId}
            productId={previewId}
            onSelect={(item) => choose(item)}
            onClose={() => setPreviewId(null)}
          />
        )}

        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="商品名で検索"
            aria-label="商品名で検索"
            autoFocus
          />
          <CatalogPicker
            catalog={catalog}
            query={query}
            favoriteIds={favoriteIds}
            onSelect={choose}
            onPreview={(c) => setPreviewId(c.id)}
          />
          {renderFooter?.(query.trim(), () => setOpen(false))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
