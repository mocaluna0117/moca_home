"use client";

import { FileText, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ImagePreview } from "@/components/image-preview";
import { Button } from "@/components/ui/button";
import {
  attachOrderFile,
  detachOrderFile,
  discardUnattachedOrderFile,
} from "@/lib/actions";
import { callAction } from "@/lib/call-action";
import {
  MAX_ORDER_FILES,
  formatFileSize,
  isImageContentType,
} from "@/lib/order-files";
import { PhotoConvertError, preparePhoto } from "@/lib/prepare-photo";
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
  /** 上げている最中の割合。null なら何もしていない */
  const [uploading, setUploading] = useState<number | null>(null);
  /** 表示に失敗した画像の id。壊れたサムネイルを出し続けない */
  const [failed, setFailed] = useState<number[]>([]);

  const full = files.length >= MAX_ORDER_FILES;

  function addFiles(list: FileList | null) {
    const chosen = list ? Array.from(list) : [];
    if (chosen.length === 0) return;
    const room = MAX_ORDER_FILES - files.length;
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
            写真だけブラウザで縮小する。PDF は canvas で扱えないので
            そのまま上げる（prepare-photo.ts は画像専用）。
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
        toast.success(`${added}件を添付しました`);
      }
    });
  }

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
        <div className="ml-auto flex items-center gap-2">
          {uploading !== null && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              {Math.round(uploading)}%
            </span>
          )}
          {/* label に input を隠して包む。ボタンの見た目のまま複数選択できる */}
          <label className={full || isPending ? "pointer-events-none opacity-50" : ""}>
            <input
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="sr-only"
              disabled={full || isPending}
              onChange={(e) => {
                addFiles(e.target.files);
                // 同じファイルを続けて選べるように毎回リセットする
                e.target.value = "";
              }}
            />
            <span className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border px-2.5 text-[0.8rem] font-medium transition-colors hover:bg-muted">
              <Upload className="size-3.5" aria-hidden="true" />
              ファイルを添付
            </span>
          </label>
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
