"use client";

import { PackageSearch, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

type Progress =
  | { phase: "login" }
  | { phase: "list"; page: number; lastPage: number }
  | { phase: "orders"; done: number; total: number }
  | { phase: "products"; done: number; total: number }
  | {
      phase: "catalog";
      probed: number;
      estimatedTotal: number;
      currentId: number;
      found: number;
    }
  | { phase: "done" }
  | {
      phase: "result";
      ok: boolean;
      busy?: boolean;
      error?: string;
      summary?: {
        totalOrders?: number;
        ordersInserted?: number;
        ordersDetailed?: number;
        productsOk?: number;
        productsNotFound?: number;
      };
    };

function label(p: Progress | null) {
  if (!p) return "同期中…";
  switch (p.phase) {
    case "login":
      return "ログイン中…";
    case "list":
      return `一覧 ${p.page}/${p.lastPage}`;
    case "orders":
      return `注文 ${p.done}/${p.total}`;
    case "products":
      return `商品 ${p.done}/${p.total}`;
    case "catalog":
      return `ID ${p.currentId} / +${p.found}`;
    default:
      return "仕上げ中…";
  }
}

export function SyncButton({
  hasData,
  mode = "orders",
}: {
  hasData: boolean;
  mode?: "orders" | "catalog";
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [, startTransition] = useTransition();
  const isCatalog = mode === "catalog";

  async function handleClick() {
    setRunning(true);
    setProgress(null);
    if (!hasData) {
      toast.info(
        isCatalog ? "カタログ同期を開始しました" : "初回同期を開始しました",
        {
          description: isCatalog
            ? "全商品IDを走査するため初回は30分ほどかかります。タブは開いたままにしてください。`npm run sync -- --catalog` でも実行できます。"
            : "全件取得のため2〜3分かかります。",
        },
      );
    }

    try {
      const res = await fetch(isCatalog ? "/api/sync/catalog" : "/api/sync", {
        method: "POST",
      });
      if (!res.body) throw new Error("応答が空です");

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let result: Progress | null = null;

      // NDJSON: one JSON object per line, the last one being the result.
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as Progress;
          if (event.phase === "result") result = event;
          else setProgress(event);
        }
      }
      if (buffer.trim()) {
        const event = JSON.parse(buffer) as Progress;
        if (event.phase === "result") result = event;
      }

      if (result && result.phase === "result") {
        if (result.ok) {
          const s = result.summary;
          toast.success(isCatalog ? "カタログ同期完了" : "同期完了", {
            description: s
              ? isCatalog
                ? `商品 ${s.productsOk ?? 0}件を新規取得` +
                  ((s.productsNotFound ?? 0) > 0
                    ? ` / 欠番 ${s.productsNotFound}件`
                    : "")
                : `注文 ${s.totalOrders}件（新規 ${s.ordersInserted}件）/ 商品 ${s.productsOk}件` +
                  (s.productsNotFound ? ` / 販売終了 ${s.productsNotFound}件` : "")
              : undefined,
          });
          startTransition(() => router.refresh());
        } else {
          toast.error(result.busy ? "同期が既に実行中です" : "同期に失敗しました", {
            description: result.error,
          });
        }
      } else {
        toast.error("同期の結果を受け取れませんでした");
      }
    } catch (err) {
      toast.error("同期に失敗しました", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  return (
    <Button
      onClick={handleClick}
      disabled={running}
      variant={isCatalog ? "ghost" : hasData ? "outline" : "default"}
      size="sm"
      className="min-w-[8.5rem] tabular-nums"
    >
      {isCatalog ? (
        <PackageSearch className={running ? "animate-pulse" : undefined} />
      ) : (
        <RefreshCw className={running ? "animate-spin" : undefined} />
      )}
      {running ? label(progress) : isCatalog ? "カタログ同期" : "同期"}
    </Button>
  );
}
