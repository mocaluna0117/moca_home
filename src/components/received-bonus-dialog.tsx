"use client";

import { Gift, Plus, Sparkles, Trash2 } from "lucide-react";
import Image from "next/image";
import { useState, useTransition } from "react";
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
import { Input } from "@/components/ui/input";
import { formatYen } from "@/lib/format";

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
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>届いたおまけを記録</DialogTitle>
          <DialogDescription>
            注文 {orderId} に実際に入っていたおまけを入力してください。
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
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
                    {catalog === null ? (
                      <p className="text-xs text-muted-foreground">
                        商品リストを読み込み中…
                      </p>
                    ) : (
                      <ul className="max-h-64 divide-y overflow-y-auto rounded border">
                        {catalog
                          .filter((c) =>
                            row.query.trim() === ""
                              ? true
                              : c.name.includes(row.query.trim()),
                          )
                          .slice(0, 8)
                          .map((c) => (
                            <li key={c.id}>
                              <button
                                type="button"
                                className="flex w-full items-start gap-2 p-2 text-left hover:bg-muted"
                                onClick={() =>
                                  patchRow(row.key, {
                                    productId: c.id,
                                    label: c.name,
                                    imageUrl: c.imageUrl,
                                    query: "",
                                  })
                                }
                              >
                                <Thumb src={c.imageUrl} alt="" />
                                <span className="flex-1 text-sm leading-snug break-words">
                                  {c.name}
                                </span>
                                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                  {formatYen(c.priceYen)}
                                </span>
                              </button>
                            </li>
                          ))}
                        {catalog.length === 0 && (
                          <li className="p-2 text-xs text-muted-foreground">
                            商品リストが空です
                          </li>
                        )}
                      </ul>
                    )}
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
