/**
 * 集計の1タイル。ホームの「買ったもの」と /orders の3連タイルが同じものを使う。
 * 別々に書くと同じ数字が2つの見た目を持ってしまい、どちらが正しいか分からなくなる。
 * value は整形済みの文字列だけを受け取る（tabular-nums が効くのは数字が
 * 文字列として来る前提。整形の作法は src/lib/format.ts が持つ）。
 */
export function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-semibold tabular-nums">{value}</div>
    </div>
  );
}
