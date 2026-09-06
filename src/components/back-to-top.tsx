"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * ページの先頭に戻るボタン。1画面ぶん以上スクロールしたときだけ出る。
 *
 * 購入履歴・お気に入り・食べたものは件数に上限が無く、下まで見たあと
 * 先頭に戻る手段が「指でこすり続ける」しか無かった。
 *
 * **アプリで唯一 window を触るコンポーネント。** html/body に overflow を
 * 付けていないので、スクロールしているのは文書そのもの。だから
 * window.scrollY で正しく、ページ側に何も足さなくてよい。
 */
export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    /*
      閾値は「1画面ぶん」。固定px（600 など）にすると、縦長のデスクトップでは
      半画面スクロールしただけで出てきて邪魔になる。scrollY も innerHeight も
      読んでもレイアウトを再計算させない値。
    */
    const update = () => setVisible(window.scrollY > window.innerHeight);
    // 購読の前に1回見る。「戻る」でスクロール位置ごと復元されて開くことがある
    update();
    /*
      preventDefault しないので passive。先に宣言しておくとブラウザは
      ハンドラの完了を待たずにスクロールできる。
      間引きはしない — 同じ値の setState は React が同値と見て捨てるので、
      実際に再描画されるのは「出る」「消える」の2回だけ。
    */
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  // 隠すときは描かない。opacity-0 だと見えないボタンにフォーカスが当たる
  if (!visible) return null;

  return (
    <Button
      variant="outline"
      size="icon-lg"
      aria-label="ページの先頭に戻る"
      /*
        z-30。ページの中身は最大 z-20（sticky ヘッダー・カードの中の逃がし）、
        ダイアログは z-50。あいだに置けば常に中身より前・ダイアログより後ろに
        なるので、ダイアログを開いている間に隠す処理が要らない。
        size-11（44px）は指で押す物の下限。sm 以上の 24px は通知（sonner）の
        余白と同じで、トーストの列に重なっても脇からはみ出して見えない。
      */
      className="fixed right-4 bottom-4 z-30 size-11 rounded-full shadow-sm duration-100 animate-in fade-in-0 sm:right-6 sm:bottom-6"
      onClick={() => {
        /*
          html に scroll-behavior: smooth を足さない。足すとページ遷移のたびの
          自動スクロールまで滑るようになる（局所の都合で全体の挙動を変えない）。
          「動きを減らす」設定は behavior:"smooth" には効かないので、押した
          瞬間に自分で見て auto に落とす。
        */
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
      }}
    >
      <ArrowUp className="size-5" aria-hidden="true" />
    </Button>
  );
}
