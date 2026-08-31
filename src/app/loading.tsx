import { Skeleton } from "@/components/ui/skeleton";

/**
 * アプリで唯一の loading.tsx。自分の loading を持たない
 * /calendar・/care・/favorites・/login がこれを継ぐので、
 * **どのページの形にも寄せない**。
 *
 * 特定のページの形を写すと、他のページでは「別の画面が出てから中身に
 * 入れ替わる」ちらつきになる。見出し1本 + 大きな塊1つ + 中くらい4つの
 * 抽象な骨なら、どのページの前でも「読み込み中」以上のことを言わない。
 * 形の合った骨が要るページは自分の loading.tsx を置く（/orders がそれ）。
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-6 w-40 rounded-md" />
      <Skeleton className="h-32 rounded-xl" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
