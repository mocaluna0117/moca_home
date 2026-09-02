import { CircleCheck, CircleDashed, Repeat } from "lucide-react";

import { UsualMealDialog } from "@/components/calendar/usual-meal-dialog";
import { Thumb } from "@/components/catalog-picker";
import { ProductName } from "@/components/product-name";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader } from "@/components/ui/card";
import { SLOT_LABEL_LONG } from "@/lib/calendar";
import type { UsualMealRow } from "@/lib/queries-log";
import { USUAL_SLOTS, type UsualSlot } from "@/lib/usual-meals";

/** 分量とメモ。片方しか無くても「 ・ 」が浮かない（home.ts と同じ繋ぎ方） */
function meta(row: UsualMealRow): string | null {
  const parts = [row.amount, row.note].filter(
    (p): p is string => p !== null && p !== "",
  );
  return parts.length === 0 ? null : parts.join(" ・ ");
}

/**
 * 「いつものご飯」の登録画面（RSC）。入力はダイアログ側（client）が持つ。
 *
 * ここは記録ではなく**登録**の一覧なので、カレンダーの日付とは無関係に
 * 朝・夜の2枚だけを並べる。並び順は USUAL_SLOTS が決める（getUsualMeals の
 * 並びは slot の文字列順なので夜が先に来る。朝 → 夜はこの定数だけが持つ）。
 */
export function UsualMealSection({
  rows,
  todayRecorded,
}: {
  rows: UsualMealRow[];
  /** 今日そのスロットに記録があるか。印を付けない代わりの唯一のフィードバック */
  todayRecorded: Record<UsualSlot, boolean>;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading inline-flex items-center gap-1.5 text-sm font-medium">
        <Repeat className="size-4" aria-hidden="true" />
        いつものご飯
      </h2>

      {rows.length === 0 ? (
        /*
          破線 = このアプリでの「まだ空」の記号（care-section / heartworm-section /
          getting-started と同じ形）。ここは教える場面なので、下の説明文
          （毎朝8時・夜も朝に入る・消しても入り直さない）は出さない。まだ1品も
          登録していない人に4文を先に読ませても、決めるのに要らない情報が多い。
        */
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            まだ「いつものご飯」が登録されていません
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            朝ごはん・夜ごはんによく食べるものを登録すると、毎朝その日の記録として自動で入ります。
            入ったあとは、手で書いた記録と同じ扱いです（あとから直せます）。
          </p>
          <ul className="mt-2 inline-flex flex-col items-start text-xs text-muted-foreground">
            <li>・登録した日より前の日には入りません</li>
            <li>・その日をもう記録していたら、上書きしません</li>
          </ul>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {/* rows が空なので、ボタンの文字はダイアログ側で
                「いつもの朝ごはんを登録」になる（どちらのスロットか読める） */}
            {USUAL_SLOTS.map((slot) => (
              <UsualMealDialog
                key={slot}
                slot={slot}
                rows={[]}
                triggerVariant="outline"
              />
            ))}
          </div>
        </div>
      ) : (
        <>
          {USUAL_SLOTS.map((slot) => {
            /*
              groupUsualBySlot を使わないのは、あれが UsualItem（記録に入れる
              側の形）に狭めてしまい、一覧に要る id と imageUrl が落ちるため。
              適用の順序と「品目0件を落とす」判断は planUsualApply が持つ。
            */
            const items = rows.filter((r) => r.slot === slot);
            const label = SLOT_LABEL_LONG[slot];

            return (
              <Card key={slot} size="sm">
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-heading text-sm font-medium">{label}</h3>
                    {items.length > 0 ? (
                      <Badge variant="secondary" className="font-normal tabular-nums">
                        {items.length}品
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="font-normal">
                        未登録
                      </Badge>
                    )}
                  </div>
                  {items.length > 0 && (
                    <CardAction>
                      <UsualMealDialog
                        slot={slot}
                        rows={items.map((it) => ({
                          id: it.id,
                          productId: it.productId,
                          label: it.label,
                          amount: it.amount,
                          note: it.note,
                          imageUrl: it.imageUrl,
                        }))}
                        triggerVariant="ghost"
                      />
                    </CardAction>
                  )}
                </CardHeader>

                <CardContent className="flex flex-col gap-2">
                  {items.length === 0 ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        登録すると、毎朝その日の記録として入ります。
                      </p>
                      {/*
                        未登録の側だけボタンを本文に置く。文字が長い
                        （「いつもの夜ごはんを登録」）ので、320px の見出し行に
                        押し込むと見出しが1文字ずつ折り返す。
                      */}
                      <div>
                        <UsualMealDialog
                          slot={slot}
                          rows={[]}
                          triggerVariant="outline"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <ul className="flex flex-col gap-2">
                        {items.map((it) => {
                          const detail = meta(it);
                          return (
                            <li
                              key={it.id}
                              className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-md border p-2"
                            >
                              <Thumb src={it.imageUrl} alt="" />
                              <span className="min-w-0 flex-1 text-sm leading-snug break-words">
                                <ProductName name={it.label} />
                              </span>
                              {detail !== null && (
                                <span className="text-xs text-muted-foreground tabular-nums">
                                  {detail}
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                      {/*
                        言えるのは「今日その時間の記録があるか」だけ。自動で
                        入った行に印を付けない決定なので、「いつものが入った」
                        とは言えない（手で入れた記録も同じ「記録あり」になる）。
                      */}
                      <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        {todayRecorded[slot] ? (
                          <CircleCheck className="size-3.5" aria-hidden="true" />
                        ) : (
                          <CircleDashed className="size-3.5" aria-hidden="true" />
                        )}
                        今日の{label}: {todayRecorded[slot] ? "記録あり" : "まだ"}
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}

          <p className="text-xs text-muted-foreground">
            毎朝8時ごろ、その日の朝ごはん・夜ごはんがまだ空なら、いつものご飯を記録として入れます。
            すでに記録がある日は書き換えません（手で入れた記録が消えることはありません）。
            夜ごはんも朝いちどに入るので、実際に食べる前から記録に見えます。
            入れたくない日は「記録」タブでその日の記録を消してください。
            消した記録が翌朝また入ることはありません（その日のうちに
            この画面で同じ時間の登録を保存し直したときだけ、空いているぶんに入ります）。
          </p>
        </>
      )}
    </section>
  );
}
