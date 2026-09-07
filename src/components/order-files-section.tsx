"use client";

import { FileText, Paperclip, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ImagePreview } from "@/components/image-preview";
import { OrderFileUploadButton } from "@/components/order-file-upload-button";
import { Button } from "@/components/ui/button";
import { detachOrderFile } from "@/lib/actions";
import { callAction } from "@/lib/call-action";
import {
  MAX_ORDER_FILES,
  formatFileSize,
  isImageContentType,
} from "@/lib/order-files";
import type { OrderFileRow } from "@/lib/queries";

/**
 * 注文に添付したファイル（領収書のPDF・梱包や商品の写真）。
 *
 * **写真と PDF で見せ方を変える。** 写真はサムネイルを出して押したら拡大
 * （ImagePreview を使う）。PDF はサムネイルを作れないので、ファイル名の行に
 * して別タブで開く — ルートが Content-Disposition: inline を付けているので、
 * ブラウザの PDF ビューアで読める。
 *
 * **保存ボタンを置かない。** 紐づけ先の注文はもう存在しているので、選んだ
 * その場で上げて紐づける（写真の記録ダイアログのように「あとで保存」に
 * すると、上げ終わったのに保存を押していない状態が生まれる）。
 */
export function OrderFilesSection({
  orderId,
  files,
}: {
  orderId: string;
  files: OrderFileRow[];
}) {
  const [isPending, startTransition] = useTransition();
  /** 表示に失敗した画像の id。壊れたサムネイルを出し続けない */
  const [failed, setFailed] = useState<number[]>([]);

  function remove(file: OrderFileRow) {
    startTransition(async () => {
      const res = await callAction(() => detachOrderFile(file.id));
      if (res.ok) toast.success("添付を削除しました");
      else toast.error("削除に失敗しました", { description: res.error });
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-heading inline-flex items-center gap-1.5 text-sm font-medium">
          <Paperclip className="size-4" aria-hidden="true" />
          添付ファイル
        </h2>
        {files.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {files.length}件
          </span>
        )}
        <div className="ml-auto">
          {/* 上げる処理は一覧のカードと共有している（同じ1つの経路） */}
          <OrderFileUploadButton orderId={orderId} currentCount={files.length} />
        </div>
      </div>

      {files.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">まだ添付がありません</p>
          <p className="mt-1 text-xs text-muted-foreground">
            領収書や明細のPDF、梱包や届いた商品の写真を残しておけます。
            写真は押すと拡大、PDFは別タブで開きます。
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {files.map((f) => {
            const src = `/api/order-files/${f.id}`;
            const size = formatFileSize(f.sizeBytes);
            const showThumb = isImageContentType(f.contentType) && !failed.includes(f.id);
            return (
              <li
                key={f.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border p-3"
              >
                {showThumb ? (
                  <ImagePreview
                    images={[src]}
                    caption={f.fileName}
                    title="添付ファイル"
                    className="shrink-0"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element --
                        private な blob を /api 経由で出すので next/image は使わない */}
                    <img
                      src={src}
                      alt=""
                      width={48}
                      height={48}
                      loading="lazy"
                      decoding="async"
                      className="size-12 rounded-md border object-contain"
                      onError={() => setFailed((ids) => [...ids, f.id])}
                    />
                  </ImagePreview>
                ) : (
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-md border text-muted-foreground">
                    <FileText className="size-5" aria-hidden="true" />
                  </span>
                )}

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{f.fileName}</span>
                  {size !== null && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {size}
                    </span>
                  )}
                </span>

                <a
                  href={src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  開く
                </a>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${f.fileName}を削除`}
                  disabled={isPending}
                  onClick={() => remove(f)}
                >
                  <Trash2 />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        写真とPDFを{MAX_ORDER_FILES}件まで、1件10MBまで。
        削除するとファイルそのものも消えます（元に戻せません）。
      </p>
    </section>
  );
}
