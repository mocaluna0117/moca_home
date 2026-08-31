import { Skeleton } from "@/components/ui/skeleton";

/**
 * /orders 専用の骨。ルートの loading.tsx にあったこの形をここへ移した。
 *
 * 一覧は形が毎回同じ（3連スタット → タブ → OrderCard の縦並び）なので、
 * 寸法まで合わせた骨が置ける。ルートに置いたままだと /calendar や /care が
 * これを継いで、来ない一覧の形を一瞬見せてしまう。
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-9 w-48 rounded-lg" />
      <div className="flex flex-col gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
