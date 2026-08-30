"use client";

import { upload } from "@vercel/blob/client";
import { Camera, ImagePlus, Syringe, X } from "lucide-react";
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
  attachVaccinationPhoto,
  detachVaccinationPhoto,
  saveVaccination,
} from "@/lib/actions-log";
import type { DateStr } from "@/lib/calendar";

export interface PhotoRef {
  id: number;
  width: number | null;
  height: number | null;
}

export interface VaccinationRecord {
  id: number;
  date: DateStr;
  name: string;
  clinic: string | null;
  nextDueDate: string | null;
  note: string | null;
  photos: PhotoRef[];
}

const MAX_EDGE = 2000;
const QUALITY = 0.82;
/** これより小さい画像は再エンコードしない（世代劣化を避ける） */
const SKIP_BELOW_BYTES = 1.5 * 1024 * 1024;

/**
 * アップロード前にブラウザで縮小する。スマホ写真は 3〜12MB あり、
 * そのままだと回線と保存容量を無駄に使う。
 * 失敗した場合（HEIC を decode できない・低メモリ端末）は原本をそのまま
 * 送る — 直アップロードなのでサイズ上限に引っかからない。
 */
async function prepare(file: File): Promise<{
  body: Blob | File;
  contentType: string;
  width: number | null;
  height: number | null;
}> {
  if (file.size < SKIP_BELOW_BYTES) {
    return { body: file, contentType: file.type || "image/jpeg", width: null, height: null };
  }
  try {
    // imageOrientation を指定しないと iPhone の縦写真が横倒しになる
    // （canvas は EXIF の回転情報を落とすため）
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, "image/jpeg", QUALITY),
    );
    if (!blob) throw new Error("encode failed");
    return { body: blob, contentType: "image/jpeg", width: w, height: h };
  } catch {
    return { body: file, contentType: file.type || "image/jpeg", width: null, height: null };
  }
}

export function VaccinationDialog({
  record,
  today,
  blobEnabled,
  trigger,
  triggerVariant = "outline",
}: {
  record?: VaccinationRecord;
  today: DateStr;
  blobEnabled: boolean;
  trigger: string;
  triggerVariant?: "default" | "outline" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(record?.date ?? today);
  const [name, setName] = useState(record?.name ?? "");
  const [clinic, setClinic] = useState(record?.clinic ?? "");
  const [nextDue, setNextDue] = useState(record?.nextDueDate ?? "");
  const [note, setNote] = useState(record?.note ?? "");
  const [photos, setPhotos] = useState<PhotoRef[]>(record?.photos ?? []);
  const [uploading, setUploading] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setDate(record?.date ?? today);
      setName(record?.name ?? "");
      setClinic(record?.clinic ?? "");
      setNextDue(record?.nextDueDate ?? "");
      setNote(record?.note ?? "");
      setPhotos(record?.photos ?? []);
      setUploading(null);
    }
  }

  function handleSave() {
    startTransition(async () => {
      const res = await saveVaccination({
        id: record?.id,
        date,
        name,
        clinic: clinic.trim() || null,
        nextDueDate: nextDue.trim() || null,
        note: note.trim() || null,
      });
      if (res.ok) {
        toast.success(record ? "記録を更新しました" : "接種を記録しました");
        setOpen(false);
      } else {
        toast.error("保存に失敗しました", { description: res.error });
      }
    });
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (!record) {
      toast.info("先に記録を保存してください", {
        description: "保存すると写真を添付できるようになります。",
      });
      return;
    }
    for (const file of Array.from(files)) {
      setUploading(0);
      try {
        const { body, contentType, width, height } = await prepare(file);
        const blob = await upload(`vaccinations/${crypto.randomUUID()}.jpg`, body, {
          // ストアは private（証明書に氏名・住所が写るため）。閲覧は
          // 同一オリジンの /api/vaccination-photos/[id] 経由で行う。
          access: "private",
          contentType,
          handleUploadUrl: "/api/blob/upload",
          onUploadProgress: ({ percentage }) => setUploading(percentage),
        });
        const res = await attachVaccinationPhoto(record.id, {
          url: blob.url,
          pathname: blob.pathname,
          contentType,
          sizeBytes: body.size,
          width,
          height,
        });
        if (res.ok) {
          toast.success("写真を追加しました");
          // 一覧の再取得は revalidatePath 側で走るのでダイアログを閉じる
          setOpen(false);
        } else {
          toast.error("写真の登録に失敗しました", { description: res.error });
        }
      } catch (err) {
        toast.error("アップロードに失敗しました", {
          description: err instanceof Error ? err.message : undefined,
        });
      } finally {
        setUploading(null);
      }
    }
  }

  function handleDeletePhoto(photoId: number) {
    startTransition(async () => {
      const res = await detachVaccinationPhoto(photoId);
      if (res.ok) {
        setPhotos((ps) => ps.filter((p) => p.id !== photoId));
        toast.success("写真を削除しました");
      } else {
        toast.error("削除に失敗しました", { description: res.error });
      }
    });
  }

  const valid = date !== "" && name.trim() !== "";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant={triggerVariant} size="sm">
            <Syringe aria-hidden="true" />
            {trigger}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{record ? "接種記録を編集" : "接種を記録"}</DialogTitle>
          <DialogDescription>
            接種した日とワクチン名を記録します。証明書の写真も添付できます。
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">接種日</span>
            {/* value が YYYY-MM-DD でスキーマと同形 — 変換を挟まない */}
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">ワクチン名</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 6種混合ワクチン"
              required
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">動物病院（任意）</span>
            <Input value={clinic} onChange={(e) => setClinic(e.target.value)} />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">次回予定日（任意）</span>
            <Input
              type="date"
              value={nextDue}
              onChange={(e) => setNextDue(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">メモ（任意）</span>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>

          {blobEnabled && (
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <span className="text-sm font-medium">接種証明書の写真</span>
              {!record ? (
                <p className="text-xs text-muted-foreground">
                  記録を保存すると写真を添付できます。
                </p>
              ) : (
                <>
                  {photos.length > 0 && (
                    <ul className="flex flex-wrap gap-2">
                      {photos.map((p) => (
                        <li key={p.id} className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/vaccination-photos/${p.id}`}
                            alt="接種証明書"
                            className="size-20 rounded border object-cover"
                          />
                          <button
                            type="button"
                            aria-label="この写真を削除"
                            className="absolute -top-2 -right-2 rounded-full border bg-background p-1 text-muted-foreground hover:text-foreground"
                            onClick={() => handleDeletePhoto(p.id)}
                          >
                            <X className="size-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {uploading !== null && (
                    <p className="text-xs text-muted-foreground tabular-nums">
                      アップロード中… {Math.round(uploading)}%
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <label className="cursor-pointer">
                      <span className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm">
                        <Camera className="size-4" aria-hidden="true" />
                        カメラで撮る
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="sr-only"
                        onChange={(e) => handleFiles(e.target.files)}
                      />
                    </label>
                    <label className="cursor-pointer">
                      <span className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm">
                        <ImagePlus className="size-4" aria-hidden="true" />
                        写真を選ぶ
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="sr-only"
                        onChange={(e) => handleFiles(e.target.files)}
                      />
                    </label>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <DialogClose render={<Button variant="ghost">キャンセル</Button>} />
          <Button disabled={isPending || !valid} onClick={handleSave}>
            {isPending ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
