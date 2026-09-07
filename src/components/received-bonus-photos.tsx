"use client";

import { Camera, Loader2, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ImagePreview } from "@/components/image-preview";
import { buttonVariants } from "@/components/ui/button";
import {
  attachReceivedBonusPhoto,
  detachReceivedBonusPhoto,
  discardUnattachedBonusPhoto,
} from "@/lib/actions";
import { MAX_BONUS_PHOTOS } from "@/lib/bonus-photos";
import { callAction } from "@/lib/call-action";
import { PhotoConvertError, preparePhoto } from "@/lib/prepare-photo";
import type { ReceivedBonusPhotoRef } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * 届いたおまけの写真まわり（1つのおまけに 0..n 枚）。
 *
 * **押せるものはこの1ファイルに集める。** 置き場所が3つある:
 *  - `BonusPhotoAddBox`  … 写真がまだ無い行の48pxの枠。**枠そのものが選択**
 *  - `BonusPhotoButton`  … 行の右端のカメラ（2枚目以降を足す）
 *  - `BonusPhotoStrip`   … 名前の下の一覧。押すと拡大、✕で1枚だけ外す
 * 上げる処理は下の `useBonusPhotoUpload` 1本だけが持つ（3か所で書くと、
 * 片方だけ直して食い違う）。呼び出す側（received-bonus-section.tsx）は
 * サーバ部品なので、client 側の入り口をここにまとめる意味もある。
 *
 * ダイアログを開かない。押すと OS のファイル選択がそのまま開き、選んだ
 * 瞬間に上げて紐づける（紐づけ先の行はもう存在しているので、「あとで保存」
 * にすると、上げ終わったのに保存を押していない状態が生まれる）。
 * 作法は order-file-upload-button.tsx と同じ。
 */
function useBonusPhotoUpload(bonusId: number, currentCount: number) {
  const [isPending, startTransition] = useTransition();
  /** 上げている最中の割合。null なら何もしていない */
  const [uploading, setUploading] = useState<number | null>(null);

  const full = currentCount >= MAX_BONUS_PHOTOS;

  function addFiles(list: FileList | null) {
    const chosen = list ? Array.from(list) : [];
    if (chosen.length === 0) return;
    const room = MAX_BONUS_PHOTOS - currentCount;
    if (room <= 0) {
      toast.error(`写真は${MAX_BONUS_PHOTOS}枚までです`);
      return;
    }
    const targets = chosen.slice(0, room);
    if (targets.length < chosen.length) {
      toast.error(`${chosen.length - targets.length}枚は上限を超えるので見送りました`);
    }

    startTransition(async () => {
      let failed = 0;
      for (const file of targets) {
        setUploading(0);
        let uploaded: string | null = null;
        try {
          /*
            出るのは一覧の48px・列の56pxと拡大表示だけ。もらった袋の文字が
            拡大で読める程度は残したいので 1200px（薬のパッケージは640pxだが、
            あちらは名前が別に文字で入っている）。
          */
          const prepared = await preparePhoto(file, { maxEdge: 1200 });
          // Blob の SDK は押した瞬間に読み込む（初回JSに 120KB を乗せない）
          const { upload } = await import("@vercel/blob/client");
          const blob = await upload(
            `bonuses/${crypto.randomUUID()}.jpg`,
            prepared.body,
            {
              // ストアは private。表示は同一オリジンの
              // /api/bonus-photos/[id] 経由で、Blob の URL は直接開けない
              access: "private",
              contentType: prepared.contentType,
              handleUploadUrl: "/api/blob/upload",
              onUploadProgress: ({ percentage }) => setUploading(percentage),
            },
          );
          uploaded = blob.pathname;
          const attached = await callAction(() =>
            attachReceivedBonusPhoto(bonusId, {
              url: blob.url,
              pathname: blob.pathname,
              contentType: prepared.contentType,
              sizeBytes: prepared.body.size,
              width: prepared.width,
              height: prepared.height,
            }),
          );
          if (!attached.ok) {
            failed++;
            // Blob には載ったのに行がどこも指していない状態を残さない
            await callAction(() => discardUnattachedBonusPhoto(blob.pathname));
            toast.error("写真を保存できませんでした", {
              description: attached.error,
            });
          }
        } catch (err) {
          failed++;
          if (uploaded) {
            const orphan = uploaded;
            await callAction(() => discardUnattachedBonusPhoto(orphan));
          }
          toast.error(
            err instanceof PhotoConvertError
              ? "この写真は変換できませんでした"
              : "写真を保存できませんでした",
            { description: "通信を確かめて、もう一度お試しください。" },
          );
        }
      }
      setUploading(null);
      const added = targets.length - failed;
      if (added > 0) toast.success(`写真を${added}枚付けました`);
    });
  }

  return { isPending, uploading, full, addFiles };
}

/** 隠したファイル選択。`<label>` の中に置いて、見た目は親が決める */
function PhotoInput({
  disabled,
  onFiles,
}: {
  disabled: boolean;
  onFiles: (files: FileList | null) => void;
}) {
  return (
    <input
      type="file"
      accept="image/*"
      multiple
      className="sr-only"
      disabled={disabled}
      onChange={(e) => {
        onFiles(e.target.files);
        // 同じファイルを続けて選べるように毎回リセットする
        e.target.value = "";
      }}
    />
  );
}

/**
 * 写真がまだ1枚も無い行の、48pxの枠。**枠そのものがファイル選択。**
 * 空の枠を押しても何も起きないのが分かりにくかったので、絵が無い場所を
 * そのまま入口にする（商品リストから選んだ行では出さない — あちらには
 * 商品画像があり、押すと拡大表示になる）。
 */
export function BonusPhotoAddBox({
  bonusId,
  className,
}: {
  bonusId: number;
  className?: string;
}) {
  const { isPending, uploading, addFiles } = useBonusPhotoUpload(bonusId, 0);

  return (
    <label
      className={cn(
        "flex cursor-pointer items-center justify-center border-dashed text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        isPending && "pointer-events-none opacity-50",
        className,
      )}
      title="写真を付ける"
      aria-label="写真を付ける"
    >
      <PhotoInput disabled={isPending} onFiles={addFiles} />
      {uploading !== null ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <Camera className="size-4" aria-hidden="true" />
      )}
    </label>
  );
}

/**
 * 行の右端のカメラ。**2枚目以降を足すためだけ**に出す。
 * 0枚のときは左の48pxの枠が入口なので、こちらは出さない（1行に上げる入口を
 * 2つ置くと、片方で上げている最中にもう片方が押せてしまう）。
 */
export function BonusPhotoButton({
  bonusId,
  currentCount,
}: {
  bonusId: number;
  currentCount: number;
}) {
  const { isPending, uploading, full, addFiles } = useBonusPhotoUpload(
    bonusId,
    currentCount,
  );
  const disabled = full || isPending;
  const label = full
    ? `写真は${MAX_BONUS_PHOTOS}枚までです`
    : currentCount > 0
      ? "写真を足す"
      : "写真を付ける";

  return (
    <label
      className={cn(
        buttonVariants({ variant: "ghost", size: "icon" }),
        "cursor-pointer",
        disabled && "pointer-events-none opacity-50",
      )}
      title={label}
      aria-label={label}
    >
      <PhotoInput disabled={disabled} onFiles={addFiles} />
      {uploading !== null ? (
        <Loader2 className="animate-spin" aria-hidden="true" />
      ) : (
        <Camera aria-hidden="true" />
      )}
    </label>
  );
}

/**
 * 名前の下に並ぶ写真の一覧。押すとその写真から拡大表示が開き（矢印で送れる）、
 * 右上の✕でその1枚だけを外す。
 *
 * ✕は `ImagePreview` の**外**に置く（あれは children を `<button>` で包むので、
 * 中に入れるとボタンの中にボタンが入る）。接種証明書の写真の列と同じ形。
 */
export function BonusPhotoStrip({
  photos,
  caption,
}: {
  photos: ReceivedBonusPhotoRef[];
  caption: string;
}) {
  const [isPending, startTransition] = useTransition();
  const srcs = photos.map((p) => `/api/bonus-photos/${p.id}`);

  if (photos.length === 0) return null;

  function remove(photoId: number) {
    startTransition(async () => {
      const res = await callAction(() => detachReceivedBonusPhoto(photoId));
      if (res.ok) toast.success("写真を外しました");
      else toast.error("削除に失敗しました", { description: res.error });
    });
  }

  return (
    <ul className="mt-1.5 flex flex-wrap gap-2">
      {photos.map((p, i) => (
        <li key={p.id} className="relative">
          <ImagePreview
            images={srcs}
            startIndex={i}
            caption={caption}
            title="おまけの写真"
            className="relative block size-14 overflow-hidden rounded border bg-muted"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={srcs[i]}
              alt=""
              // 実寸を書いて枠を確保し、画面外は取りに行かない
              width={56}
              height={56}
              loading="lazy"
              decoding="async"
              className="size-full object-cover"
            />
          </ImagePreview>
          <button
            type="button"
            aria-label="この写真を外す"
            title="この写真を外す"
            disabled={isPending}
            onClick={() => remove(p.id)}
            className="absolute -top-2 -right-2 rounded-full border bg-background p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}
