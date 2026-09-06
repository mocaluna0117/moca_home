"use client";

import {
  ChevronLeft,
  ChevronRight,
  Expand,
  ExternalLink,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * 画像を押して大きく見るためのビューア。
 *
 * 商品の写真は枠が 48〜80px、薬の写真は 40px しかなく、パッケージの文字が
 * 読めない。押したら全面で開けるようにする（接種証明書の photo-strip.tsx と
 * 同じ考え方で、状態の持ち方・等倍の作法・キー操作もあちらに合わせてある）。
 *
 * **ビューアの中身はただの `<img src>`。** 商品画像は next/image を
 * `unoptimized` で使っており、あれがしているのは `fill` の位置決めだけ。
 * 薬の写真は元から生の `<img>`。だからこのコンポーネントは URL の配列だけを
 * 受け取れば、どちらの出どころでも同じように描ける。
 *
 * `ImageWithFallback` には手を入れない。あれは「商品・注文明細の写真」専用と
 * 自分で宣言しており、private blob の API から来る薬の写真には届かない。
 *
 * 全画面ビューアがこれと photo-strip.tsx の2つになるが、証明書側は
 * id ベースのAPIと削除ボタンを持つので今回は統合しない。`images` ＋
 * `startIndex` の形はあちらに合わせてあるので、将来 photo-strip を
 * このコンポーネントの上に畳める。
 */
export function ImagePreview({
  images,
  caption,
  title = "画像",
  startIndex = 0,
  nested = false,
  variant = "surface",
  className,
  children,
}: {
  /**
   * 拡大して見せる画像のURL。null / undefined は落とすので、呼び出し側は
   * `[item.imageUrl]` のように素で渡してよい。0枚になったら押せる物を描かない。
   */
  images: (string | null | undefined)[];
  /** 拡大したときの説明に出す名前（商品名・薬の名前） */
  caption: string;
  /** ダイアログの見出し。既定は「画像」 */
  title?: string;
  /** 最初に開く1枚。商品詳細の2枚目以降のサムネイルから開くときに使う */
  startIndex?: number;
  /**
   * 既に開いているダイアログの中から使うとき。Base UI は入れ子のとき
   * 背景を描かないので、forceRender で自前の暗幕を出す必要がある。
   */
  nested?: boolean;
  /**
   * surface: children（サムネイル）そのものが押せる面になる。
   * corner: 小さな「拡大」ボタンだけを描く。写真の押し先が既に別のリンクで
   *   埋まっているカードで使う（children は無視する）。
   */
  variant?: "surface" | "corner";
  /** surface のときは呼び出し側の枠（relative size-… bg-muted）をそのまま渡す */
  className?: string;
  children?: React.ReactNode;
}) {
  const urls = images.filter((u): u is string => Boolean(u));
  const [index, setIndex] = useState<number | null>(null);
  const [zoomed, setZoomed] = useState(false);
  // 読み込めなかった URL。商品画像はショップへの直リンクで、販売終了すると404
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  // 索引が範囲外なら閉じている扱い（photo-strip.tsx と同じ）
  const open = index !== null && index < urls.length;
  const current = open ? urls[index] : null;
  // null を落としたぶん索引がずれるので、呼び出し側の値は信用せず丸める
  const start = Math.min(Math.max(startIndex, 0), Math.max(urls.length - 1, 0));

  function move(delta: number) {
    setZoomed(false);
    setIndex((i) => ((i ?? 0) + delta + urls.length) % urls.length);
  }

  function openViewer(e: React.MouseEvent) {
    // カード全体がリンクの場所でも使うので、遷移させない
    // （favorite-button.tsx が同じ理由で同じことをしている）
    e.preventDefault();
    e.stopPropagation();
    setZoomed(false);
    setFailedSrc(null);
    setIndex(start);
  }

  // 押しても何も出ないボタンは描かない。surface は枠だけ元どおり返す
  if (urls.length === 0) {
    if (variant === "corner") return null;
    return <div className={className}>{children}</div>;
  }

  const label = `${caption} の画像を拡大`;

  return (
    <>
      {variant === "corner" ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          title="拡大"
          className={className}
          onClick={openViewer}
        >
          {/* ビューアの中の等倍トグルが ZoomIn / ZoomOut なので、
              開くための記号はそれと別のものにする */}
          <Expand aria-hidden="true" />
        </Button>
      ) : (
        /*
          呼び出し側の枠（relative size-… bg-muted）をそのままこのボタンに
          載せ替える。ImageWithFallback は fill なので、枠と画像のあいだに
          ボタンを挟むと高さ0の当たり判定になる。
        */
        <button
          type="button"
          aria-label={label}
          onClick={openViewer}
          className={cn(
            "block cursor-zoom-in outline-none transition-opacity hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50",
            className,
          )}
        >
          {children}
        </button>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setIndex(null);
        }}
      >
        <DialogContent
          className="sm:max-w-5xl"
          // 既に開いているダイアログの上に重なるときは、Base UI が入れ子の
          // 背景を描かないので forceRender で自前の暗幕を出す
          overlayProps={
            nested
              ? { forceRender: true, className: "bg-black/60" }
              : { className: "bg-black/60" }
          }
          onKeyDown={(e) => {
            if (urls.length < 2) return;
            if (e.key === "ArrowRight") {
              e.preventDefault();
              move(1);
            } else if (e.key === "ArrowLeft") {
              e.preventDefault();
              move(-1);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {caption}
              {urls.length > 1 && (
                <span className="ml-2 tabular-nums">
                  {(index ?? 0) + 1} / {urls.length}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {current &&
            (failedSrc === current ? (
              <p className="rounded border bg-muted p-6 text-center text-sm text-muted-foreground">
                画像を読み込めませんでした
              </p>
            ) : (
              <div
                className={
                  zoomed
                    ? "max-h-[70vh] overflow-auto rounded border bg-muted"
                    : "flex max-h-[70vh] justify-center overflow-hidden rounded border bg-muted"
                }
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  key={current}
                  src={current}
                  alt={caption}
                  onClick={() => setZoomed((z) => !z)}
                  onError={() => setFailedSrc(current)}
                  // 等倍は max-w-none だけでよい。<img> は幅指定が無ければ
                  // 実寸で描画される（photo-strip.tsx と同じ）
                  className={
                    zoomed
                      ? "max-w-none cursor-zoom-out"
                      : "max-h-[70vh] w-auto cursor-zoom-in object-contain"
                  }
                />
              </div>
            ))}

          <div className="flex flex-wrap items-center gap-2">
            {urls.length > 1 && (
              <>
                <Button variant="outline" size="sm" onClick={() => move(-1)}>
                  <ChevronLeft aria-hidden="true" />
                  前へ
                </Button>
                <Button variant="outline" size="sm" onClick={() => move(1)}>
                  次へ
                  <ChevronRight aria-hidden="true" />
                </Button>
              </>
            )}
            <Button variant="ghost" size="sm" onClick={() => setZoomed((z) => !z)}>
              {zoomed ? <ZoomOut aria-hidden="true" /> : <ZoomIn aria-hidden="true" />}
              {zoomed ? "全体を表示" : "等倍で見る"}
            </Button>
            {current && (
              <a
                href={current}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                別タブで開く
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
