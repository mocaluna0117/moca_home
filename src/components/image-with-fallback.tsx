"use client";

import { ImageOff } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Product images are hotlinked from the shop; time-limited items sometimes
 * lose their image file, so a 404 must not leave a broken box behind.
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
      className={cn("object-cover", className)}
      onError={() => setFailed(true)}
      unoptimized
    />
  );
}
