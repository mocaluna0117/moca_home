"use client";

import { Camera, ImageOff, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  discardUnattachedBonusPhoto,
  removeReceivedBonusPhoto,
  setReceivedBonusPhoto,
} from "@/lib/actions";
import { callAction } from "@/lib/call-action";
import { PhotoConvertError, preparePhoto } from "@/lib/prepare-photo";
import { cn } from "@/lib/utils";

/**
 * 届いたおまけ1行に写真を付けるボタン（1行1枚。押すと差し替え）。
 *
 * **これが要る理由**: 自由入力のおまけはカタログの商品を指さないので
 * 商品画像が無く、一覧では贈り物アイコンだけだった。もらった実物を写真で
 * 残せるようにする。
 *
 * ダイアログを開かない。押すと OS のファイル選択がそのまま開き、選んだ
 * 瞬間に上げて紐づける（紐づけ先の行はもう存在しているので、「あとで
 * 保存」にすると、上げ終わったのに保存を押していない状態が生まれる）。
 * order-file-upload-button.tsx と同じ作法で、あちらが注文に対して 0..n 件、
 * こちらがおまけの行に対して高々1枚。
 *
 * `<button>` ではなく `<label>` で隠した input を包む（ボタンの見た目は
 * buttonVariants を借りる）。写真を外すほうは素の Button でよい。
 */
export function ReceivedBonusPhotoButton({
  bonusId,
  hasPhoto,
}: {
  bonusId: number;
  /** すでに写真があるか。文言と「外す」の出し分けに使う */
  hasPhoto: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  /** 上げている最中の割合。null なら何もしていない */
  const [uploading, setUploading] = useState<number | null>(null);

  function choose(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;

    startTransition(async () => {
      let prepared;
      try {
        /*
          出るのは一覧の48pxと拡大表示だけ。もらった袋の文字が拡大で読める
          程度は残したいので 1200px（薬のパッケージ写真は640pxだが、あれは
          名前が別に文字で入っている）。変換できない原本はそのまま上げる。
        */
        prepared = await preparePhoto(file, { maxEdge: 1200 });
      } catch (err) {
        toast.error(
          err instanceof PhotoConvertError
            ? "この写真は変換できませんでした"
            : "写真を準備できませんでした",
          { description: "別の写真をえらんでください。" },
        );
        return;
      }

      setUploading(0);
      let uploaded: string | null = null;
      try {
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
          setReceivedBonusPhoto({
            bonusId,
            url: blob.url,
            pathname: blob.pathname,
            contentType: prepared.contentType,
            sizeBytes: prepared.body.size,
          }),
        );
        if (!attached.ok) {
          // Blob には載ったのに行がどこも指していない状態を残さない
          await callAction(() => discardUnattachedBonusPhoto(blob.pathname));
          toast.error("写真を保存できませんでした", {
            description: attached.error,
          });
          return;
        }
      } catch {
        if (uploaded) {
          const orphan = uploaded;
          await callAction(() => discardUnattachedBonusPhoto(orphan));
        }
        toast.error("写真を保存できませんでした", {
          description: "通信を確かめて、もう一度お試しください。",
        });
        return;
      } finally {
        setUploading(null);
      }

      toast.success(hasPhoto ? "写真を差し替えました" : "写真を付けました");
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await callAction(() => removeReceivedBonusPhoto(bonusId));
      if (res.ok) toast.success("写真を外しました");
      else toast.error("削除に失敗しました", { description: res.error });
    });
  }

  const label = hasPhoto ? "写真を差し替える" : "写真を付ける";

  return (
    <>
      <label
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "cursor-pointer",
          isPending && "pointer-events-none opacity-50",
        )}
        title={label}
        aria-label={label}
      >
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={isPending}
          onChange={(e) => {
            choose(e.target.files);
            // 同じファイルを続けて選べるように毎回リセットする
            e.target.value = "";
          }}
        />
        {uploading !== null ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Camera aria-hidden="true" />
        )}
      </label>
      {hasPhoto && (
        <Button
          variant="ghost"
          size="icon"
          title="写真を外す"
          aria-label="写真を外す"
          disabled={isPending}
          onClick={remove}
        >
          <ImageOff aria-hidden="true" />
        </Button>
      )}
    </>
  );
}
