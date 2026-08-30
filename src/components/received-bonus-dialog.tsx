"use client";

import { Gift, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { saveReceivedBonuses, type DraftRowInput } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { ProductName } from "@/components/product-name";
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
import {
  CatalogPicker,
  ProductPreview,
  Thumb,
  useCatalog,
} from "@/components/catalog-picker";
import { Input } from "@/components/ui/input";

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
  const [preview, setPreview] = useState<{ rowKey: number; productId: number } | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();
  const catalog = useCatalog(open);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    setPreview(null);
    if (next) {
      setRows(existing.length > 0 ? existing.map(toRow) : [emptyRow()]);
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
                      <ProductName name={row.label} />
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
