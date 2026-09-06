"use client";

import { upload } from "@vercel/blob/client";
import { ImageOff, Pill, Plus, Trash2, Upload } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  removeMedicinePhoto,
  saveMedicine,
  setMedicinePhoto,
} from "@/lib/actions-care";
import { discardUnattachedMedicinePhoto } from "@/lib/actions-care";
import { callAction } from "@/lib/call-action";
import { PhotoConvertError, preparePhoto } from "@/lib/prepare-photo";

/**
 * 薬の登録・編集。名前と「フィラリア用か」、それにパッケージの写真1枚。
 *
 * **写真は編集のときだけ**出す。実体を紐づける先の行が要るので、新規登録では
 * まず名前だけ保存してもらう（dog_profile と同じ「行が先」の順序）。
 */
export function MedicineDialog({
  medicine,
  blobEnabled = false,
  trigger,
  triggerVariant = "outline",
}: {
  medicine?: {
    id: number;
    name: string;
    forHeartworm: boolean;
    hasPhoto: boolean;
    photoUpdatedAt: string | null;
  };
  /** Blob が未設定なら写真の欄そのものを出さない（名前だけで機能は成立する） */
  blobEnabled?: boolean;
  trigger?: string;
  triggerVariant?: "default" | "outline" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(medicine?.name ?? "");
  const [forHeartworm, setForHeartworm] = useState(medicine?.forHeartworm ?? false);
  const [isPending, startTransition] = useTransition();
  /** 選んだがまだ上げていない写真。プレビューの URL は必ず解放する */
  const [pending, setPending] = useState<{ file: File; previewUrl: string } | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  /** 保存後に写真を出すための版。差し替えたら ?v= が変わる */
  const [photoVersion, setPhotoVersion] = useState(medicine?.photoUpdatedAt ?? "");
  const [hasPhoto, setHasPhoto] = useState(medicine?.hasPhoto ?? false);

  const showPhoto = blobEnabled && medicine !== undefined;
  const photoSrc =
    hasPhoto && medicine
      ? `/api/medicine-photos/${medicine.id}?v=${encodeURIComponent(photoVersion)}`
      : null;

  function discardPending() {
    if (pending) URL.revokeObjectURL(pending.previewUrl);
    setPending(null);
  }

  /** 写真は1枚。選び直しは前のプレビューを解放してから差し替える */
  function choosePhoto(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (pending) URL.revokeObjectURL(pending.previewUrl);
    setPending({ file, previewUrl: URL.createObjectURL(file) });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setName(medicine?.name ?? "");
      setForHeartworm(medicine?.forHeartworm ?? false);
      setHasPhoto(medicine?.hasPhoto ?? false);
      setPhotoVersion(medicine?.photoUpdatedAt ?? "");
      setUploading(null);
      discardPending();
    } else {
      discardPending();
    }
  }

  function removePhoto() {
    if (!medicine) return;
    startTransition(async () => {
      const res = await callAction(() => removeMedicinePhoto(medicine.id));
      if (res.ok) {
        setHasPhoto(false);
        toast.success("写真を削除しました");
      } else {
        toast.error("削除に失敗しました", { description: res.error });
      }
    });
  }

  /**
   * 保存。順序が要る（profile-dialog.tsx と同じ）—
   * 1. 名前を保存して**行を先に**確定させる
   * 2. ブラウザで縮小。変換できなければ上げずに終わる
   * 3. Blob へ直アップロード
   * 4. setMedicinePhoto でメタデータを行へ
   * 5. 4 が失敗したら discardUnattachedMedicinePhoto で上げた実体を戻す
   */
  function handleSave() {
    startTransition(async () => {
      const res = await callAction(() =>
        saveMedicine({ id: medicine?.id, name, forHeartworm }),
      );
      if (!res.ok) {
        toast.error("保存に失敗しました", { description: res.error });
        return;
      }
      if (!pending || !medicine) {
        toast.success(medicine ? "薬を更新しました" : "薬を登録しました");
        setOpen(false);
        return;
      }

      let prepared;
      try {
        // 出るのはダイアログの中と一覧のサムネイルだけ。長辺1200pxで足りる。
        // 変換に失敗した原本はそのまま上げる（証明書と同じ扱い。HEIC のまま
        // でも記録としては残り、開ける端末では見られる）
        prepared = await preparePhoto(pending.file, { maxEdge: 1200 });
      } catch (err) {
        toast.error(
          err instanceof PhotoConvertError
            ? "この写真は変換できませんでした"
            : "写真を準備できませんでした",
          { description: "名前は保存済みです。別の写真をえらんでください。" },
        );
        return;
      }

      setUploading(0);
      let uploaded: string | null = null;
      try {
        const blob = await upload(
          `medicines/${crypto.randomUUID()}.jpg`,
          prepared.body,
          {
            // ストアは private。表示は同一オリジンの
            // /api/medicine-photos/[id] 経由で、Blob の URL は直接開けない
            access: "private",
            contentType: prepared.contentType,
            handleUploadUrl: "/api/blob/upload",
            onUploadProgress: ({ percentage }) => setUploading(percentage),
          },
        );
        uploaded = blob.pathname;
        const attached = await callAction(() =>
          setMedicinePhoto({
            medicineId: medicine.id,
            url: blob.url,
            pathname: blob.pathname,
            contentType: prepared.contentType,
            sizeBytes: prepared.body.size,
          }),
        );
        if (!attached.ok) {
          // Blob には載ったのに行がどこも指していない状態を残さない
          await callAction(() => discardUnattachedMedicinePhoto(blob.pathname));
          toast.error("写真を保存できませんでした", { description: attached.error });
          return;
        }
      } catch {
        if (uploaded) {
          const orphan = uploaded;
          await callAction(() => discardUnattachedMedicinePhoto(orphan));
        }
        toast.error("写真を保存できませんでした", {
          description: "名前は保存済みです。通信を確かめてもう一度お試しください。",
        });
        return;
      } finally {
        setUploading(null);
      }

      toast.success("薬を更新しました", { description: "写真も保存しました。" });
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant={triggerVariant} size="sm">
            {medicine ? <Pill aria-hidden="true" /> : <Plus aria-hidden="true" />}
            {trigger ?? (medicine ? "編集" : "薬を登録")}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{medicine ? "薬を編集" : "薬を登録"}</DialogTitle>
          <DialogDescription>
            登録すると、記録するときに選べるようになります。
            名前を直すと、この薬を選んである記録の表示も一緒に直ります。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">薬の名前</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: モキシデック チュアブル"
              autoFocus
              required
            />
          </label>

          <label className="flex items-start gap-2 rounded-lg border p-3">
            <input
              type="checkbox"
              checked={forHeartworm}
              onChange={(e) => setForHeartworm(e.target.checked)}
              className="mt-0.5 size-4"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">フィラリア予防薬</span>
              <span className="text-xs text-muted-foreground">
                入れておくと、フィラリアの記録でこの薬を選べるようになります。
                入れなければ薬の一覧に残るだけです。
              </span>
            </span>
          </label>

          {showPhoto && (
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <span className="text-sm font-medium">パッケージの写真（任意）</span>
              <div className="flex items-start gap-3">
                {/*
                  private な blob を /api 経由で出すので next/image は使わない
                  （profile-frame.tsx と同じ理由）。選択中のプレビューは
                  blob: URL なので、そもそも最適化の対象にならない
                */}
                {pending ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={pending.previewUrl}
                    alt=""
                    className="size-16 shrink-0 rounded-md border object-contain"
                  />
                ) : photoSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photoSrc}
                    alt=""
                    className="size-16 shrink-0 rounded-md border object-contain"
                    onError={() => setHasPhoto(false)}
                  />
                ) : (
                  <span className="flex size-16 shrink-0 items-center justify-center rounded-md border border-dashed text-muted-foreground">
                    <ImageOff className="size-5" aria-hidden="true" />
                  </span>
                )}

                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <label className="w-fit">
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => choosePhoto(e.target.files)}
                    />
                    <span className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border px-2.5 text-[0.8rem] font-medium transition-colors hover:bg-muted">
                      <Upload className="size-3.5" aria-hidden="true" />
                      {pending || hasPhoto ? "写真を選び直す" : "写真を選ぶ"}
                    </span>
                  </label>
                  {pending && (
                    <span className="text-xs text-muted-foreground">
                      「保存」を押すと写真も一緒に保存します。
                    </span>
                  )}
                  {uploading !== null && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      アップロード中… {Math.round(uploading)}%
                    </span>
                  )}
                  {!pending && hasPhoto && (
                    <Button
                      variant="ghost"
                      size="xs"
                      className="w-fit text-destructive"
                      disabled={isPending}
                      onClick={removePhoto}
                    >
                      <Trash2 aria-hidden="true" />
                      写真を削除
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {blobEnabled && medicine === undefined && (
            <p className="text-xs text-muted-foreground">
              写真は登録したあとに付けられます（この薬の「編集」を開いてください）。
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <DialogClose render={<Button variant="ghost">キャンセル</Button>} />
          <Button disabled={isPending || name.trim() === ""} onClick={handleSave}>
            {isPending ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
