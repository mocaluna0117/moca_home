"use client";

import { Loader2, Upload } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { buttonVariants } from "@/components/ui/button";
import {
  attachOrderFile,
  discardUnattachedOrderFile,
} from "@/lib/actions";
import { callAction } from "@/lib/call-action";
import { MAX_ORDER_FILES } from "@/lib/order-files";
import { PhotoConvertError, preparePhoto } from "@/lib/prepare-photo";
import { cn } from "@/lib/utils";

/**
 * 注文にファイルを添付するボタン。**注文詳細と購入履歴の一覧の両方が使う。**
 *
 * ダイアログを開かない。押すと OS のファイル選択がそのまま開き、選んだ
 * 瞬間に上げて紐づける（紐づけ先の注文はもう存在しているので、「あとで
 * 保存」にすると、上げ終わったのに保存を押していない状態が生まれる）。
 * 結果はトーストで言い、件数の表示は revalidatePath で更新される。
 *
 * `<button>` ではなく `<label>` で隠した input を包む。ボタンの見た目は
 * buttonVariants を借りる（month-nav.tsx が <Link> に対して、
 * urgent-band.tsx が <a> に対してやっているのと同じ作法）。
 *
 * 一覧のカードの中で使うときは、呼び出し側が `relative z-20` で包むこと。
 * カード全体を覆うリンク（z-10）より手前に出さないと、押したときに
 * 注文詳細へ遷移してしまう（order-card.tsx のコメント参照）。
 */
export function OrderFileUploadButton({
  orderId,
  currentCount,
  label = "ファイルを添付",
  variant = "outline",
  className,
}: {
  orderId: string;
  /** すでに付いている数。上限に達していたら押せなくする */
  currentCount: number;
  label?: string;
  variant?: "outline" | "ghost";
  className?: string;
}) {
  const [isPending, startTransition] = useTransition();
  /** 上げている最中の割合。null なら何もしていない */
  const [uploading, setUploading] = useState<number | null>(null);

  const full = currentCount >= MAX_ORDER_FILES;
  const disabled = full || isPending;

  function addFiles(list: FileList | null) {
    const chosen = list ? Array.from(list) : [];
    if (chosen.length === 0) return;
    const room = MAX_ORDER_FILES - currentCount;
    if (room <= 0) {
      toast.error(`添付は${MAX_ORDER_FILES}件までです`);
      return;
    }
    const targets = chosen.slice(0, room);
    if (targets.length < chosen.length) {
      toast.error(`${chosen.length - targets.length}件は上限を超えるので見送りました`);
    }

    startTransition(async () => {
      let failedCount = 0;
      for (const file of targets) {
        setUploading(0);
        let uploaded: string | null = null;
        try {
          /*
            写真だけブラウザで縮小する。PDF は canvas で扱えないのでそのまま
            上げる（prepare-photo.ts は画像専用）。
          */
          const prepared = file.type.startsWith("image/")
            ? await preparePhoto(file, { maxEdge: 2000 })
            : { body: file, contentType: file.type, width: null, height: null };

          // Blob の SDK は押した瞬間に読み込む（初回JSに 120KB を乗せない）
          const { upload } = await import("@vercel/blob/client");
          const blob = await upload(`orders/${crypto.randomUUID()}`, prepared.body, {
            // ストアは private（領収書には氏名・住所が載る）。閲覧は
            // 同一オリジンの /api/order-files/[id] 経由で行う
            access: "private",
            contentType: prepared.contentType,
            handleUploadUrl: "/api/blob/upload",
            onUploadProgress: ({ percentage }) => setUploading(percentage),
          });
          uploaded = blob.pathname;

          const res = await callAction(() =>
            attachOrderFile({
              orderId,
              url: blob.url,
              pathname: blob.pathname,
              contentType: prepared.contentType,
              sizeBytes: prepared.body.size,
              fileName: file.name,
              width: prepared.width,
              height: prepared.height,
            }),
          );
          if (!res.ok) {
            failedCount++;
            // Blob には載ったのに紐づけ先が無い状態を残さない
            await callAction(() => discardUnattachedOrderFile(blob.pathname));
            toast.error("添付に失敗しました", { description: res.error });
          }
        } catch (err) {
          failedCount++;
          if (uploaded) {
            const orphan = uploaded;
            await callAction(() => discardUnattachedOrderFile(orphan));
          }
          toast.error(
            err instanceof PhotoConvertError
              ? "この写真は変換できませんでした"
              : "添付に失敗しました",
            { description: "通信を確かめて、もう一度お試しください。" },
          );
        }
      }
      setUploading(null);
      const added = targets.length - failedCount;
      if (added > 0) {
        toast.success(`${added}件を添付しました`, {
          // 一覧から足したときは中身が見えないので、どこで見られるか言う
          description: "注文の詳細で中身を見られます。",
        });
      }
    });
  }

  return (
    <label
      className={cn(
        buttonVariants({ variant, size: "sm" }),
        "cursor-pointer",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
      title={full ? `添付は${MAX_ORDER_FILES}件までです` : "写真かPDFを選ぶ"}
    >
      <input
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          addFiles(e.target.files);
          // 同じファイルを続けて選べるように毎回リセットする
          e.target.value = "";
        }}
      />
      {uploading !== null ? (
        <>
          <Loader2 className="animate-spin" aria-hidden="true" />
          <span className="tabular-nums">{Math.round(uploading)}%</span>
        </>
      ) : (
        <>
          <Upload aria-hidden="true" />
          {label}
        </>
      )}
    </label>
  );
}
