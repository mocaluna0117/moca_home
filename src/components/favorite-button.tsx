"use client";

import { Star } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { toggleFavorite } from "@/lib/actions";
import { markFavorite } from "@/lib/favorite-cache";
import { cn } from "@/lib/utils";
import { callAction } from "@/lib/call-action";

/**
 * 星の ON/OFF。
 *
 * パレットが無彩色なので「黄色い星」は作れない。塗りつぶし（fill）と
 * 不透明度で ON/OFF を表し、aria-label にも状態を書く（色に頼らない）。
 *
 * 成功時のトーストは出さない — 星は1タップで結果が目に見える操作で、
 * 一覧で連続して押すとトーストが積み上がって邪魔になる。失敗時だけ出す。
 */
export function FavoriteButton({
  productId,
  isFavorite,
  size = "default",
  className,
}: {
  productId: number;
  isFavorite: boolean;
  size?: "default" | "sm";
  className?: string;
}) {
  const [optimistic, setOptimistic] = useOptimistic(isFavorite);
  const [, startTransition] = useTransition();

  const iconSize = size === "sm" ? "size-4" : "size-5";

  return (
    <button
      type="button"
      aria-pressed={optimistic}
      aria-label={optimistic ? "お気に入りから外す" : "お気に入りに追加"}
      title={optimistic ? "お気に入りから外す" : "お気に入りに追加"}
      className={cn(
        "inline-flex items-center justify-center rounded-md p-1.5 transition-colors",
        "hover:bg-muted",
        className,
      )}
      onClick={(e) => {
        // カード全体がリンクの場所で使うため、遷移させない
        e.preventDefault();
        e.stopPropagation();
        const next = !optimistic;
        startTransition(async () => {
          setOptimistic(next);
          const res = await callAction(() => toggleFavorite(productId, next));
          if (res.ok) {
            // 同一セッションで開くピッカーのピン留めを合わせる
            markFavorite(productId, next);
          } else {
            toast.error("お気に入りを更新できませんでした", {
              description: res.error,
            });
          }
        });
      }}
    >
      <Star
        className={cn(
          iconSize,
          optimistic
            ? "fill-foreground text-foreground"
            : "text-muted-foreground",
        )}
        aria-hidden="true"
      />
    </button>
  );
}
