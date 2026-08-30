"use client";

import { ChevronLeft, ChevronRight, ExternalLink, X, ZoomIn, ZoomOut } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ViewerPhoto {
  id: number;
  width: number | null;
  height: number | null;
}

/**
 * 接種証明書のサムネイル列と、その拡大表示。
 *
 * サムネイルは object-cover の 80px 角なので紙の中身は読めない。紙の記録を
 * 後から読み返すのがこの機能の目的なので、押したら全面で開けるようにする。
 *
 * private blob なので画像は常に同一オリジンの /api/vaccination-photos/[id]
 * 経由。セッションcookieは SameSite=Lax で、別タブへのGET遷移には付くため
 * 「元のサイズで開く」も認証ゲートの内側で成立する。
 */
export function PhotoStrip({
  photos,
  caption,
  nested = false,
  onDelete,
}: {
  photos: ViewerPhoto[];
  /** 拡大時の見出しに出す説明（例: "2026年5月3日 ・ 6種混合ワクチン"） */
  caption: string;
  /** 記録ダイアログの中から使うとき。親を沈ませる背景が要る */
  nested?: boolean;
  onDelete?: (photoId: number) => void;
}) {
  const [index, setIndex] = useState<number | null>(null);
  const [zoomed, setZoomed] = useState(false);

  // 索引が範囲外なら閉じている扱いにする。削除で枚数が減っても
  // effect で state を直しにいかずに済む（残った索引は次に開くとき上書きされる）
  const open = index !== null && index < photos.length;
  const current = open ? photos[index] : null;

  function move(delta: number) {
    setZoomed(false);
    setIndex((i) => {
      if (i === null || photos.length === 0) return i;
      return (i + delta + photos.length) % photos.length;
    });
  }

  if (photos.length === 0) return null;

  return (
    <>
      <ul className="flex flex-wrap gap-2">
        {photos.map((p, i) => (
          <li key={p.id} className="relative">
            <button
              type="button"
              onClick={() => {
                setZoomed(false);
                setIndex(i);
              }}
              aria-label={`${caption} の証明書 ${i + 1}枚目を拡大`}
              className="block overflow-hidden rounded border transition-opacity hover:opacity-80"
            >
              {/* private blob は同一オリジンのルート経由でしか読めない */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/vaccination-photos/${p.id}`}
                alt=""
                className="size-20 bg-muted object-cover"
                loading="lazy"
              />
            </button>
            {onDelete && (
              <button
                type="button"
                aria-label={`${i + 1}枚目の写真を削除`}
                className="absolute -top-2 -right-2 rounded-full border bg-background p-1 text-muted-foreground hover:text-foreground"
                onClick={() => onDelete(p.id)}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ul>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setIndex(null);
        }}
      >
        <DialogContent
          className="sm:max-w-5xl"
          // 記録ダイアログの上に重なるときは、Base UI が入れ子の背景を
          // 描かないので forceRender で自前の暗幕を出す
          overlayProps={
            nested
              ? { forceRender: true, className: "bg-black/60" }
              : { className: "bg-black/60" }
          }
          onKeyDown={(e) => {
            if (photos.length < 2) return;
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
            <DialogTitle>接種証明書</DialogTitle>
            <DialogDescription>
              {caption}
              {photos.length > 1 && (
                <span className="ml-2 tabular-nums">
                  {(index ?? 0) + 1} / {photos.length}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {current && (
            <div
              className={
                zoomed
                  ? "max-h-[70vh] overflow-auto rounded border bg-muted"
                  : "flex max-h-[70vh] justify-center overflow-hidden rounded border bg-muted"
              }
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={current.id}
                src={`/api/vaccination-photos/${current.id}`}
                alt={`${caption} の接種証明書`}
                onClick={() => setZoomed((z) => !z)}
                // 等倍は max-w-none だけでよい。<img> は幅指定が無ければ
                // 実寸で描画されるので、DB の width（縮小しなかった写真では
                // null）に頼らずに済む
                className={
                  zoomed
                    ? "max-w-none cursor-zoom-out"
                    : "max-h-[70vh] w-auto cursor-zoom-in object-contain"
                }
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {photos.length > 1 && (
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
                href={`/api/vaccination-photos/${current.id}`}
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
