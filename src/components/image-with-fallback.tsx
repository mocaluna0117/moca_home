"use client";

import { ImageOff } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Product images are hotlinked from the shop; time-limited items sometimes
 * lose their image file, so a 404 must not leave a broken box behind.
 *
 * **object-contain, not cover.** ショップの商品写真は縦長（実測で幅/高さ
 * 0.57〜0.65）で、枠はどこも正方形。cover にすると上下が4割ほど切り落とされ、
 * パッケージの上部と下部が見えなくなる（「画像が途切れている」の正体）。
 * contain にすると左右に余白が出るが、枠の背景は呼び出し側が bg-muted に
 * してあるので額装に見える。**このコンポーネントを使うのは商品・注文明細の
 * 写真だけ**（丸いプロフィール写真と接種証明書のサムネイルは意図的に
 * cover のままで、別のコンポーネントが描いている）。
 */
export function ImageWithFallback({
  src,
  alt,
  sizes,
  className,
  iconClassName,
}: {
  src: string | null | undefined;
  alt: string;
  sizes?: string;
  className?: string;
  iconClassName?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-muted text-muted-foreground",
          className,
        )}
        aria-label="画像なし"
        role="img"
      >
        <ImageOff className={cn("size-5", iconClassName)} />
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes ?? "160px"}
      className={cn("object-contain", className)}
      onError={() => setFailed(true)}
      unoptimized
    />
  );
}
