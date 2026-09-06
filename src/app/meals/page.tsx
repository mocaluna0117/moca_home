import { UtensilsCrossed } from "lucide-react";
import Link from "next/link";

import { UsualMealSection } from "@/components/calendar/usual-meal-section";
import { FavoriteButton } from "@/components/favorite-button";
import { ProductName } from "@/components/product-name";
import { ProductShortNameDialog } from "@/components/product-short-name-dialog";
import { SegmentedNav } from "@/components/segmented-nav";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SLOT_LABEL, todayJst, type DateStr } from "@/lib/calendar";
import { formatDate, nowJstIso } from "@/lib/format";
import { getFavoriteProductIds } from "@/lib/queries";
import { getFoodHistory, getMealDay, getUsualMeals } from "@/lib/queries-log";

export const dynamic = "force-dynamic";

type Tab = "usual" | "foods";

/**
 * ごはん。「いつものご飯」の登録と「食べたもの」の履歴を1つのページにまとめる。
 *
 * どちらもカレンダーのタブだったが、月グリッド（その日に何を食べたか）とは
 * 見る目的が違う — こちらは「何をいつも食べるか」「何を食べてきたか」で、
 * 日付を選ぶ操作が要らない。カレンダーはトリミングやフィラリアの印も出す
 * 場所なので、ごはんの管理はここに分けたほうが両方とも短くなる。
 */
export default async function MealsPage({ searchParams }: PageProps<"/meals">) {
  const params = await searchParams;
  const raw = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const tab: Tab = raw === "foods" ? "foods" : "usual";

  const tabs = [
    { value: "usual", label: "いつもの", href: "/meals" },
    { value: "foods", label: "食べたもの", href: "/meals?tab=foods" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <SegmentedNav items={tabs} current={tab} />
      {tab === "usual" ? (
        <UsualTab today={todayJst(nowJstIso())} />
      ) : (
        <FoodsTab />
      )}
    </div>
  );
}

/**
 * 「いつものご飯」タブ。登録の一覧と、今日その時間に記録があるかだけを渡す。
 *
 * getMealDay はカレンダーが今日の下書きを作るのに既に使っているものと同じ。
 * 「今日は記録あり／まだ」の答えが2本のクエリに分かれないよう、専用のクエリは
 * 足さない（月グリッドの印と同じ方針）。
 */
async function UsualTab({ today }: { today: DateStr }) {
  const [rows, day] = await Promise.all([getUsualMeals(), getMealDay(today)]);

  return (
    <UsualMealSection
      rows={rows}
      todayRecorded={{
        morning: day.morning.length > 0,
        evening: day.evening.length > 0,
      }}
    />
  );
}

async function FoodsTab() {
  const [foods, favoriteIds] = await Promise.all([
    getFoodHistory(),
    getFavoriteProductIds(),
  ]);

  if (foods.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <UtensilsCrossed className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">まだ食事の記録がありません</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          「カレンダー」で日を選ぶと、朝・夜・おやつを登録できます。
        </p>
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground tabular-nums">
        {foods.length}種類の食べもの
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>食べたもの</TableHead>
              <TableHead className="text-right">食べ始め</TableHead>
              <TableHead className="text-right">最後</TableHead>
              <TableHead className="text-right">日数</TableHead>
              <TableHead className="text-right">朝/夜/おやつ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {foods.map((f) => (
              <TableRow key={f.key}>
                <TableCell className="max-w-md whitespace-normal">
                  {f.productId !== null ? (
                    <Link
                      href={`/products/${f.productId}`}
                      className="text-sm leading-snug hover:underline"
                    >
                      <ProductName name={f.label} />
                    </Link>
                  ) : (
                    <span className="text-sm leading-snug">
                      <ProductName name={f.label} />
                    </span>
                  )}
                  {f.productId !== null && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <FavoriteButton
                        productId={f.productId}
                        isFavorite={favoriteIds.has(f.productId)}
                        size="sm"
                      />
                      {/*
                        短い名前の登録はここと商品ページの2箇所。長い商品名が
                        並んでいるこの表は「どれに付けるべきか」がいちばん
                        分かる場所なので、一覧から直接付けられるようにする。
                      */}
                      <ProductShortNameDialog
                        productId={f.productId}
                        productName={f.label}
                        shortName={f.registeredShortName}
                      />
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDate(f.firstDate)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDate(f.lastDate)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{f.dayCount}日</TableCell>
                <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                  {f.slots.morning}/{f.slots.evening}/{f.slots.treat}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        {SLOT_LABEL.morning}・{SLOT_LABEL.evening}・{SLOT_LABEL.treat}の順に、
        それぞれ何回登録したかを表示しています。
      </p>
    </section>
  );
}
