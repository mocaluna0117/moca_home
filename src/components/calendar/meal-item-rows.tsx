"use client";

import { Plus, Search, Trash2 } from "lucide-react";

import { Thumb } from "@/components/catalog-picker";
import { ProductSearchDialog } from "@/components/product-search-dialog";
import { ProductName } from "@/components/product-name";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MEAL_AMOUNT_UNITS,
  MAX_AMOUNT_VALUE,
  formatMealAmount,
} from "@/lib/meal-amount";
import { cn } from "@/lib/utils";

export interface DraftRow {
  id?: number;
  productId: number | null;
  label: string;
  /** 分量の数値。単位とセット（src/lib/meal-amount.ts） */
  amountValue: number | null;
  amountUnit: string | null;
  /**
   * 分ける前に入れた自由入力（"少なめ" など）。**入力欄は無い。**
   * 古い記録を開いたときに「前はこう書いてあった」と見せるためだけに運ぶ。
   * 保存すると数値と単位に置き換わり、ここは消える。
   */
  amount: string | null;
  note: string | null;
  imageUrl: string | null;
}

export interface RowState extends DraftRow {
  key: number;
  /** 商品を選ぶモードか、自由入力モードか */
  mode: "product" | "free";
  query: string;
}

/**
 * key は React が行を見分けるための目印。id は保存済みの行にしか無いので、
 * 行の同一性はこちらで振る。モジュール単位の単調増加にしてあるので、
 * ダイアログを開き直して行を作り直しても前の key とぶつからない。
 * 2つのダイアログが同じ連番を分け合うが、器が別なので支障はない。
 */
let nextKey = 1;

export function toRow(d: DraftRow): RowState {
  return {
    ...d,
    key: nextKey++,
    mode: d.productId === null && d.label ? "free" : "product",
    query: "",
  };
}

export function emptyRow(): RowState {
  return {
    key: nextKey++,
    productId: null,
    label: "",
    amountValue: null,
    amountUnit: null,
    amount: null,
    note: null,
    imageUrl: null,
    mode: "product",
    query: "",
  };
}

/**
 * 1スロットぶんの品目を並べて編集する部分。記録ダイアログから**移動**した
 * もので、見た目も操作も1文字も変えていない（移動であって再設計ではない）。
 * 「いつものご飯」の登録ダイアログが同じ自由度（商品検索・自由入力への
 * 逃げ道・分量・メモ）を要るので、170行を複製せずここから両方が使う。
 *
 * 自分では state を持たず、rows を受け取って次の配列を onChange に渡すだけ。
 * 記録ダイアログは3スロットを1つの Record でまとめて持ち、登録ダイアログは
 * 1スロットだけを持つので、器の形は親に決めさせたい。
 */
export function MealItemRows({
  rows,
  onChange,
  pickerTitle,
  prefetch,
  nested = true,
}: {
  rows: RowState[];
  onChange: (next: RowState[]) => void;
  /** ProductSearchDialog の見出し。例「朝ごはんに食べたものを選ぶ」 */
  pickerTitle: string;
  /** 親ダイアログが開いているか（カタログの先読みに使う） */
  prefetch: boolean;
  nested?: boolean;
}) {
  function patch(key: number, p: Partial<RowState>) {
    onChange(rows.map((r) => (r.key === key ? { ...r, ...p } : r)));
  }

  function addRow() {
    onChange([...rows, emptyRow()]);
  }

  function removeRow(key: number) {
    onChange(rows.filter((r) => r.key !== key));
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.key} className="flex flex-col gap-2 rounded-md border p-2">
            {row.mode === "product" ? (
              row.productId === null ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <ProductSearchDialog
                      prefetch={prefetch}
                      nested={nested}
                      title={pickerTitle}
                      description="20&20 の全商品から探せます。お気に入りは先頭に表示されます。"
                      trigger={
                        <>
                          <Search aria-hidden="true" />
                          商品を選ぶ
                        </>
                      }
                      onSelect={(c) =>
                        patch(row.key, {
                          productId: c.id,
                          label: c.name,
                          imageUrl: c.imageUrl,
                          query: "",
                        })
                      }
                    />
                    <span className="text-xs text-muted-foreground">
                      まだ選ばれていません
                    </span>
                  </div>
                  <button
                    type="button"
                    className="w-fit text-xs text-muted-foreground underline"
                    onClick={() => patch(row.key, { mode: "free" })}
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
                      patch(row.key, {
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
                  onChange={(e) => patch(row.key, { label: e.target.value })}
                  placeholder="食べたもの（例: 手作りごはん）"
                  aria-label="食べたもの"
                />
                <button
                  type="button"
                  className="w-fit text-xs text-muted-foreground underline"
                  onClick={() =>
                    patch(row.key, {
                      mode: "product",
                      label: "",
                      productId: null,
                    })
                  }
                >
                  商品リストから選ぶ
                </button>
              </>
            )}

            <div className="flex items-center gap-2">
              {/*
                分量は数値と単位に分ける。自由入力だった頃は「50g」「50ｇ」
                「50グラム」が混ざって量として比べられなかった。
                type="number" にすると電話で数字のキーパッドが出る。
              */}
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_AMOUNT_VALUE}
                step={1}
                value={row.amountValue ?? ""}
                onChange={(e) =>
                  patch(row.key, {
                    amountValue: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                placeholder="分量"
                aria-label="分量"
                className="w-20 tabular-nums"
              />
              {/* 候補は8つで検索が要らない。ライブラリを増やさずネイティブの
                  select にする（medicine-select.tsx と同じ判断・同じ見た目） */}
              <select
                value={row.amountUnit ?? ""}
                onChange={(e) =>
                  patch(row.key, { amountUnit: e.target.value === "" ? null : e.target.value })
                }
                aria-label="分量の単位"
                className={cn(
                  "h-8 w-20 shrink-0 rounded-lg border border-input bg-transparent px-2 py-1 text-base outline-none",
                  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm",
                )}
              >
                <option value="">単位</option>
                {MEAL_AMOUNT_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
              <Input
                value={row.note ?? ""}
                onChange={(e) => patch(row.key, { note: e.target.value || null })}
                placeholder="メモ（任意）"
                aria-label="メモ"
                className="flex-1"
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="この行を削除"
                onClick={() => removeRow(row.key)}
              >
                <Trash2 />
              </Button>
            </div>

            {/*
              数値と単位に分ける前に入れた分量。保存するとこの控えは消えるので、
              消える前に何と書いてあったかを見せる（「少なめ」のように数値に
              できない記録もあり、黙って捨てると気づけない）。
            */}
            {row.amountValue === null &&
              formatMealAmount({
                amountValue: row.amountValue,
                amountUnit: row.amountUnit,
                amount: row.amount,
              }) !== null && (
                <p className="text-xs text-muted-foreground">
                  以前の分量: {row.amount}（保存すると上の数値と単位に置き換わります）
                </p>
              )}
          </div>
        ))}
      </div>

      <Button variant="ghost" size="sm" className="mt-2" onClick={addRow}>
        <Plus aria-hidden="true" />
        食べたものを追加
      </Button>
    </>
  );
}
