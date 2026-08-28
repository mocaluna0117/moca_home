"use client";

import {
  ArrowLeft,
  ExternalLink,
  Gift,
  Info,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { saveReceivedBonuses, type DraftRowInput } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { parseBonusRule } from "@/lib/bonus";
import { formatYen } from "@/lib/format";
import { formatRuleLong } from "@/components/bonus-badge";

export interface CatalogItem {
  id: number;
  name: string;
  priceYen: number | null;
  imageUrl: string | null;
}

/** Serializable draft row passed from the RSC page. */
export interface ReceivedDraft {
  id?: number;
  productId: number | null;
  label: string;
  quantity: number;
  note: string | null;
  imageUrl: string | null;
}

interface RowState extends ReceivedDraft {
  key: number;
  mode: "product" | "free";
  query: string;
}

// Module-level cache: the catalog is fetched once per browser session,
// on first dialog open — never embedded in RSC renders.
let catalogCache: CatalogItem[] | null = null;

let nextKey = 1;

function toRow(d: ReceivedDraft): RowState {
  return {
    ...d,
    key: nextKey++,
    mode: d.productId === null && d.label ? "free" : "product",
    query: "",
  };
}

function emptyRow(): RowState {
  return {
    key: nextKey++,
    productId: null,
    label: "",
    quantity: 1,
    note: null,
    imageUrl: null,
    mode: "product",
    query: "",
  };
}

export function ReceivedBonusDialog({
  orderId,
  existing,
  predicted,
  catalogSynced,
  trigger,
  triggerVariant = "outline",
}: {
  orderId: string;
  existing: ReceivedDraft[];
  predicted: ReceivedDraft[];
  catalogSynced: boolean;
  trigger: string;
  triggerVariant?: "outline" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<RowState[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(catalogCache);
  const [preview, setPreview] = useState<{ rowKey: number; productId: number } | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    setPreview(null);
    if (next) {
      setRows(existing.length > 0 ? existing.map(toRow) : [emptyRow()]);
      if (!catalogCache) {
        fetch("/api/catalog")
          .then((res) => res.json())
          .then((data: { items: CatalogItem[] }) => {
            catalogCache = data.items;
            setCatalog(data.items);
          })
          .catch(() => setCatalog([]));
      }
    }
  }

  function patchRow(key: number, patch: Partial<RowState>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function appendPredicted() {
    setRows((rs) => {
      const base = rs.filter(
        (r) => r.label !== "" || r.productId !== null || r.note !== null,
      );
      return [...base, ...predicted.map(toRow)];
    });
  }

  const allRowsValid =
    rows.length > 0 &&
    rows.every(
      (r) =>
        (r.productId !== null || r.label.trim() !== "") &&
        Number.isInteger(r.quantity) &&
        r.quantity >= 1 &&
        r.quantity <= 99,
    );

  function handleSave() {
    const payload: DraftRowInput[] = rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      label: r.label,
      quantity: r.quantity,
      note: r.note?.trim() ? r.note.trim() : null,
    }));
    startTransition(async () => {
      const res = await saveReceivedBonuses(orderId, payload);
      if (res.ok) {
        toast.success("おまけを記録しました");
        setOpen(false);
      } else {
        toast.error("保存に失敗しました", { description: res.error });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant={triggerVariant} size="sm">
            <Gift aria-hidden="true" />
            {trigger}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-4xl">
        {preview && (
          <ProductPreview
            key={preview.productId}
            productId={preview.productId}
            onSelect={(item) => {
              patchRow(preview.rowKey, {
                productId: item.id,
                label: item.name,
                imageUrl: item.imageUrl,
                query: "",
              });
              setPreview(null);
            }}
            onClose={() => setPreview(null)}
          />
        )}
        <DialogHeader>
          <DialogTitle>届いたおまけを記録</DialogTitle>
          <DialogDescription>
            注文 {orderId} に実際に入っていたおまけを入力してください。
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto pr-1">
          {rows.map((row) => (
            <div key={row.key} className="flex flex-col gap-2 rounded-lg border p-3">
              {row.mode === "product" ? (
                row.productId === null ? (
                  <>
                    <Input
                      value={row.query}
                      onChange={(e) => patchRow(row.key, { query: e.target.value })}
                      placeholder="商品名で検索"
                      aria-label="商品名で検索"
                    />
                    <CatalogPicker
                      catalog={catalog}
                      query={row.query}
                      onPreview={(c) =>
                        setPreview({ rowKey: row.key, productId: c.id })
                      }
                      onSelect={(c) =>
                        patchRow(row.key, {
                          productId: c.id,
                          label: c.name,
                          imageUrl: c.imageUrl,
                          query: "",
                        })
                      }
                    />
                    {!catalogSynced && (
                      <p className="text-xs text-muted-foreground">
                        カタログ未同期のため購入済み商品のみ表示しています。ヘッダーの「カタログ同期」で全商品から選べるようになります。
                      </p>
                    )}
                    <button
                      type="button"
                      className="w-fit text-xs text-muted-foreground underline"
                      onClick={() => patchRow(row.key, { mode: "free" })}
                    >
                      商品リストにない（自由入力へ）
                    </button>
                  </>
                ) : (
                  <div className="flex items-start gap-2">
                    <Thumb src={row.imageUrl} alt="" />
                    <span className="flex-1 text-sm leading-snug break-words">
                      {row.label}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setPreview({
                          rowKey: row.key,
                          productId: row.productId as number,
                        })
                      }
                    >
                      詳細
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        patchRow(row.key, {
                          productId: null,
                          label: "",
                          imageUrl: null,
                        })
                      }
                    >
                      変更
                    </Button>
                  </div>
                )
              ) : (
                <>
                  <Input
                    value={row.label}
                    onChange={(e) => patchRow(row.key, { label: e.target.value })}
                    placeholder="おまけの名前（例: ジャーキー小袋）"
                    aria-label="おまけの名前"
                  />
                  <button
                    type="button"
                    className="w-fit text-xs text-muted-foreground underline"
                    onClick={() =>
                      patchRow(row.key, { mode: "product", label: "", productId: null })
                    }
                  >
                    商品リストから選ぶ
                  </button>
                </>
              )}

              <div className="flex items-center gap-2">
                <label
                  className="shrink-0 text-sm text-muted-foreground"
                  htmlFor={`qty-${row.key}`}
                >
                  数量
                </label>
                <Input
                  id={`qty-${row.key}`}
                  type="number"
                  min={1}
                  max={99}
                  value={row.quantity}
                  onChange={(e) =>
                    patchRow(row.key, { quantity: Number(e.target.value) })
                  }
                  className="w-20 tabular-nums"
                />
                <Input
                  value={row.note ?? ""}
                  onChange={(e) =>
                    patchRow(row.key, { note: e.target.value || null })
                  }
                  placeholder="メモ（任意）"
                  aria-label="メモ"
                  className="flex-1"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="この行を削除"
                  onClick={() =>
                    setRows((rs) => rs.filter((r) => r.key !== row.key))
                  }
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}
          {rows.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              行がありません。「行を追加」または「予測を取り込む」で入力を始めてください。
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={predicted.length === 0}
              onClick={appendPredicted}
            >
              <Sparkles aria-hidden="true" />
              予測を取り込む
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRows((rs) => [...rs, emptyRow()])}
            >
              <Plus aria-hidden="true" />
              行を追加
            </Button>
          </div>
          <div className="flex gap-2">
            <DialogClose
              render={<Button variant="ghost">キャンセル</Button>}
            />
            <Button disabled={isPending || !allRowsValid} onClick={handleSave}>
              {isPending ? "保存中…" : "保存"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** How many matches are rendered at once — the list scrolls, and the count
 *  line below tells you how many more the filter matched. */
const PICKER_LIMIT = 50;

function CatalogPicker({
  catalog,
  query,
  onSelect,
  onPreview,
}: {
  catalog: CatalogItem[] | null;
  query: string;
  onSelect: (item: CatalogItem) => void;
  onPreview: (item: CatalogItem) => void;
}) {
  if (catalog === null) {
    return (
      <p className="text-xs text-muted-foreground">商品リストを読み込み中…</p>
    );
  }

  const term = query.trim();
  const matches =
    term === "" ? catalog : catalog.filter((c) => c.name.includes(term));
  const shown = matches.slice(0, PICKER_LIMIT);

  return (
    <>
      <ul className="max-h-96 divide-y overflow-y-auto rounded border">
        {shown.map((c) => (
          <li key={c.id} className="flex items-stretch">
            <button
              type="button"
              className="flex flex-1 items-start gap-2 p-2 text-left hover:bg-muted"
              onClick={() => onSelect(c)}
            >
              <Thumb src={c.imageUrl} alt="" />
              <span className="flex-1 text-sm leading-snug break-words">
                {c.name}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {formatYen(c.priceYen)}
              </span>
            </button>
            <button
              type="button"
              aria-label={`${c.name} の詳細を見る`}
              title="詳細を見る"
              className="shrink-0 border-l px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => onPreview(c)}
            >
              <Info className="size-4" aria-hidden="true" />
            </button>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="p-3 text-xs text-muted-foreground">
            {catalog.length === 0
              ? "商品リストが空です。ヘッダーの「カタログ同期」を実行してください。"
              : "一致する商品がありません"}
          </li>
        )}
      </ul>
      <p className="text-xs text-muted-foreground tabular-nums">
        {term === ""
          ? `全 ${catalog.length} 件（新しい順に ${shown.length} 件を表示・スクロールできます）`
          : `「${term}」に一致 ${matches.length} 件` +
            (matches.length > shown.length
              ? `（上位 ${shown.length} 件を表示）`
              : "")}
      </p>
    </>
  );
}

interface CatalogProductDetail extends CatalogItem {
  category: string | null;
  tags: string[];
  imageUrls: string[];
  descriptionHtml: string | null;
}

// Details are fetched per product (descriptions are long) and cached for the
// session so re-opening the same product is instant.
const detailCache = new Map<number, CatalogProductDetail>();

/**
 * Full-surface preview inside the record dialog. A nested modal would fight
 * the parent dialog for focus, so this covers the dialog body instead and
 * returns to the picker via 戻る.
 */
function ProductPreview({
  productId,
  onSelect,
  onClose,
}: {
  productId: number;
  onSelect: (item: CatalogProductDetail) => void;
  onClose: () => void;
}) {
  const [item, setItem] = useState<CatalogProductDetail | null>(
    detailCache.get(productId) ?? null,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Cache hits are served by the useState initializer (the component is
    // keyed per product), so the effect only runs the network path.
    if (detailCache.has(productId)) return;
    let alive = true;
    fetch(`/api/catalog/${productId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("not found"))))
      .then((data: { item: CatalogProductDetail }) => {
        detailCache.set(productId, data.item);
        if (alive) setItem(data.item);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [productId]);

  const rule = item ? parseBonusRule(item.name) : null;

  return (
    <div className="absolute inset-0 z-20 flex flex-col gap-3 rounded-xl bg-popover p-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft aria-hidden="true" />
          戻る
        </Button>
        <span className="text-sm font-medium">商品の詳細</span>
      </div>

      {failed ? (
        <p className="text-sm text-muted-foreground">
          商品情報を取得できませんでした。
        </p>
      ) : !item ? (
        <p className="text-sm text-muted-foreground">読み込み中…</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          <div className="flex gap-3">
            <div className="relative size-28 shrink-0 overflow-hidden rounded border bg-muted">
              {item.imageUrl ? (
                <Image
                  src={item.imageUrl}
                  alt=""
                  fill
                  sizes="112px"
                  className="object-cover"
                  unoptimized
                />
              ) : (
                <div className="flex size-full items-center justify-center">
                  <Gift className="size-5 text-muted-foreground" aria-hidden="true" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-sm leading-snug break-words">{item.name}</p>
              <p className="font-semibold tabular-nums">
                {formatYen(item.priceYen)}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  税込
                </span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {item.category && (
                  <Badge variant="outline" className="font-normal">
                    {item.category}
                  </Badge>
                )}
                {item.tags.map((t) => (
                  <Badge key={t} variant="outline" className="font-normal">
                    {t}
                  </Badge>
                ))}
                {rule && (
                  <Badge variant="secondary" className="font-normal">
                    <Gift aria-hidden="true" />
                    {formatRuleLong(rule)}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {item.imageUrls.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {item.imageUrls.slice(1).map((src) => (
                <span
                  key={src}
                  className="relative size-14 overflow-hidden rounded border bg-muted"
                >
                  <Image
                    src={src}
                    alt=""
                    fill
                    sizes="56px"
                    className="object-cover"
                    unoptimized
                  />
                </span>
              ))}
            </div>
          )}

          {item.descriptionHtml && (
            <div
              className="text-xs leading-relaxed break-words text-muted-foreground [&_a]:underline [&_img]:my-2 [&_img]:h-auto [&_img]:max-w-full"
              // Sanitized at ingest (parseProductPage strips scripts/handlers).
              dangerouslySetInnerHTML={{ __html: item.descriptionHtml }}
            />
          )}

          <a
            href={`https://20and20.pet/store/products/detail/${item.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            ショップで見る
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        </div>
      )}

      <div className="flex justify-end gap-2 border-t pt-3">
        <Button variant="ghost" onClick={onClose}>
          閉じる
        </Button>
        <Button disabled={!item} onClick={() => item && onSelect(item)}>
          この商品を選ぶ
        </Button>
      </div>
    </div>
  );
}

function Thumb({ src, alt }: { src: string | null; alt: string }) {
  if (!src) {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded border bg-muted">
        <Gift className="size-3.5 text-muted-foreground" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className="relative size-8 shrink-0 overflow-hidden rounded border bg-muted">
      <Image src={src} alt={alt} fill sizes="32px" className="object-cover" unoptimized />
    </span>
  );
}
