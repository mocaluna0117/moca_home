"use client";

import { upload } from "@vercel/blob/client";
import { Camera, ImagePlus, Sparkles, Syringe, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { MaskEditorDialog } from "@/components/calendar/mask-editor";
import { PhotoStrip } from "@/components/calendar/photo-strip";
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
  discardUnattachedPhoto,
  saveVaccination,
} from "@/lib/actions-log";
import type { AiProvider } from "@/lib/ai";
import { callAction } from "@/lib/call-action";
import type { DateStr } from "@/lib/calendar";
// 引数なしで呼ぶ。既定値が旧 prepare() の定数と1:1 なので挙動は変わらない
import { preparePhoto } from "@/lib/prepare-photo";
import type { NormalizedExtraction } from "@/lib/vaccination-extract";

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

const MAX_PHOTOS = 8;

/**
 * 保存前の写真。Blob へのアップロードは「保存」を押したあと、記録が
 * DB にできてから行う。こうすると孤児 blob が原理的に生まれない
 * （キャンセルされた時点ではまだ何も上がっていない）。
 */
interface PendingPhoto {
  key: number;
  file: File;
  previewUrl: string;
}

let nextPendingKey = 1;

/** 読み取り結果が既存の入力と食い違ったときの提案 */
interface Suggestion {
  field: "date" | "name" | "clinic" | "nextDue";
  label: string;
  value: string;
}

export function VaccinationDialog({
  record,
  today,
  blobEnabled,
  aiProvider,
  trigger,
  triggerVariant = "outline",
}: {
  record?: VaccinationRecord;
  today: DateStr;
  blobEnabled: boolean;
  /** 読み取りの送り先。null なら自動入力の導線を出さない */
  aiProvider: AiProvider | null;
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
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [reading, setReading] = useState(false);
  // 目隠しエディタに渡している写真。null なら閉じている
  const [maskTarget, setMaskTarget] = useState<File | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  // 新規作成の接種日は today で初期表示しているだけ。人が触っていなければ
  // 「未入力」と同じ扱いにして、証明書の日付で上書きしてよい
  const [dateTouched, setDateTouched] = useState(false);
  const [isPending, startTransition] = useTransition();

  function resetPending(list: PendingPhoto[]) {
    for (const p of list) URL.revokeObjectURL(p.previewUrl);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setDate(record?.date ?? today);
      setName(record?.name ?? "");
      setClinic(record?.clinic ?? "");
      setNextDue(record?.nextDueDate ?? "");
      setNote(record?.note ?? "");
      setPhotos(record?.photos ?? []);
      setSuggestions([]);
      setDateTouched(false);
      setUploading(null);
      setReading(false);
      setMaskTarget(null);
      setPending((prev) => {
        resetPending(prev);
        return [];
      });
    } else {
      // 閉じた時点でまだ何もアップロードしていないので、プレビューを解放するだけ
      setPending((prev) => {
        resetPending(prev);
        return [];
      });
    }
  }

  /** 接種日が「まだ人の入力ではない」か */
  const dateIsFree = !record && !dateTouched;

  /**
   * 読み取り結果をフォームへ入れる。
   *
   * 規則: **空欄だけを自動で埋める**。すでに入力がある欄は勝手に上書きせず、
   * 「置き換える」ボタンとして提案に回す。写真を足しただけで打ち直した値が
   * 消えるのが一番困るため。
   */
  function applyExtraction(fields: NormalizedExtraction) {
    const filled: string[] = [];
    const conflicts: Suggestion[] = [];

    const put = (
      field: Suggestion["field"],
      label: string,
      value: string | null,
      current: string,
      set: (v: string) => void,
    ) => {
      if (!value) return;
      if (current.trim() === "") {
        set(value);
        filled.push(label);
      } else if (current.trim() !== value) {
        conflicts.push({ field, label, value });
      }
    };

    // 新規で日付に触っていなければ初期値（today）は空欄と同じ
    put("date", "接種日", fields.date, dateIsFree ? "" : date, (v) => {
      setDate(v);
      // 入れたあとは「埋まっている」扱いにする。そうしないと2枚目の写真で
      // 黙って上書きされ、どちらが採用されたのか分からなくなる
      setDateTouched(true);
    });
    put("name", "ワクチン名", fields.name, name, setName);
    put("clinic", "動物病院", fields.clinic, clinic, setClinic);
    put("nextDue", "次回予定日", fields.nextDueDate, nextDue, setNextDue);

    // 今回の読み取り結果で必ず置き換える。条件付きにすると、衝突の無い
    // 2枚目を入れたときに前回の提案が残り、無関係な値に「置き換える」が
    // 出たままになる
    setSuggestions(conflicts);

    if (filled.length === 0 && conflicts.length === 0) {
      toast.info("証明書から読み取れる項目がありませんでした", {
        description: "手入力してください。",
      });
      return;
    }

    const extras: string[] = [];
    if (fields.nextDueDateApproximate && filled.includes("次回予定日")) {
      extras.push("次回予定日は「日」の記載が無かったため1日にしています");
    }
    if (fields.dropped.length > 0) {
      extras.push(`${fields.dropped.join("・")}は読み取れませんでした`);
    }
    if (filled.length > 0) {
      toast.success(`証明書から${filled.join("・")}を入力しました`, {
        description: extras.length > 0 ? extras.join("。") : "内容を確認して保存してください。",
      });
    }
  }

  function applySuggestion(s: Suggestion) {
    if (s.field === "date") setDate(s.value);
    else if (s.field === "name") setName(s.value);
    else if (s.field === "clinic") setClinic(s.value);
    else setNextDue(s.value);
    setSuggestions((list) => list.filter((x) => x !== s));
  }

  /** 選ばれた写真を保留に積み、そのまま証明書の読み取りにかける */
  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const room = MAX_PHOTOS - photos.length - pending.length;
    if (room <= 0) {
      toast.error(`写真は${MAX_PHOTOS}枚までです`);
      return;
    }
    const chosen = Array.from(files).slice(0, room);

    setPending((prev) => [
      ...prev,
      ...chosen.map((file) => ({
        key: nextPendingKey++,
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ]);

    if (!aiEnabled) return;
    // 4項目とも埋まっているなら読み取っても入る先が無い。編集で写真だけ
    // 足す場合がこれに当たるので、余計な送信をしない。
    const allFilled =
      !dateIsFree &&
      date !== "" &&
      name.trim() !== "" &&
      clinic.trim() !== "" &&
      nextDue.trim() !== "";
    if (allFilled) return;

    // 読み取りは1枚目だけ。裏面や2枚目に同じ項目は載っていないのが普通。
    // すぐには送らず、まず目隠しエディタを開いて本人に確認してもらう。
    setMaskTarget(chosen[0]);
  }

  /** 目隠し済みの画像を読み取りに出す。ここが唯一、外へ画像を送る場所 */
  async function runExtraction(masked: Blob) {
    setMaskTarget(null);
    setReading(true);
    try {
      const body = new FormData();
      body.append("file", new File([masked], "cert.jpg", { type: "image/jpeg" }));
      const res = await fetch("/api/vaccinations/extract", { method: "POST", body });
      const data = (await res.json()) as
        | { ok: true; fields: NormalizedExtraction }
        | { ok: false; error: string };
      if (!res.ok || !data.ok) {
        toast.error("証明書の読み取りに失敗しました", {
          description: "error" in data ? data.error : undefined,
        });
        return;
      }
      applyExtraction(data.fields);
    } catch {
      toast.error("証明書の読み取りに失敗しました", {
        description: "手入力で記録できます。",
      });
    } finally {
      setReading(false);
    }
  }

  function removePending(key: number) {
    setPending((prev) => {
      const hit = prev.find((p) => p.key === key);
      if (hit) URL.revokeObjectURL(hit.previewUrl);
      return prev.filter((p) => p.key !== key);
    });
  }

  /**
   * 保存 → できた記録に保留中の写真を添付。
   * この順序が要。記録が先にあるので、添付は既存の attachVaccinationPhoto を
   * そのまま使えるし、Blob に上げたのに紐づけ先が無い、という状態が起きない。
   */
  function handleSave() {
    startTransition(async () => {
      const res = await callAction(() =>
        saveVaccination({
          id: record?.id,
          date,
          name,
          clinic: clinic.trim() || null,
          nextDueDate: nextDue.trim() || null,
          note: note.trim() || null,
        }),
      );
      if (!res.ok) {
        toast.error("保存に失敗しました", { description: res.error });
        return;
      }

      let failed = 0;
      // ここで処理する分だけを控える。保存中に足された写真を巻き込んで
      // 消さないため（下の後片付けで使う）
      const processing = pending;
      for (const item of processing) {
        setUploading(0);
        let uploaded: { pathname: string } | null = null;
        try {
          const { body, contentType, width, height } = await preparePhoto(item.file);
          const blob = await upload(`vaccinations/${crypto.randomUUID()}.jpg`, body, {
            // ストアは private（証明書に氏名・住所が写るため）。閲覧は
            // 同一オリジンの /api/vaccination-photos/[id] 経由で行う。
            access: "private",
            contentType,
            handleUploadUrl: "/api/blob/upload",
            onUploadProgress: ({ percentage }) => setUploading(percentage),
          });
          uploaded = { pathname: blob.pathname };
          const attached = await callAction(() =>
            attachVaccinationPhoto(res.id, {
              url: blob.url,
              pathname: blob.pathname,
              contentType,
              sizeBytes: body.size,
              width,
              height,
            }),
          );
          if (!attached.ok) {
            failed++;
            // Blob には載ったのに紐づけ先が無い状態を残さない。
            // DB行が無いので、あとから消す手段が無くなる
            await callAction(() => discardUnattachedPhoto(blob.pathname));
          }
        } catch {
          failed++;
          if (uploaded) {
            const orphan = uploaded.pathname;
            await callAction(() => discardUnattachedPhoto(orphan));
          }
        }
      }
      setUploading(null);

      if (failed > 0) {
        toast.error(`写真${failed}枚の添付に失敗しました`, {
          description: "記録は保存されています。編集からもう一度お試しください。",
        });
      } else {
        toast.success(record ? "記録を更新しました" : "接種を記録しました");
      }
      setOpen(false);
      // 保存中に足された写真は残す。処理した分だけを解放する
      setPending((prev) => {
        const done = new Set(processing.map((x) => x.key));
        resetPending(processing);
        return prev.filter((x) => !done.has(x.key));
      });
    });
  }

  function handleDeletePhoto(photoId: number) {
    startTransition(async () => {
      const res = await callAction(() => detachVaccinationPhoto(photoId));
      if (res.ok) {
        setPhotos((ps) => ps.filter((p) => p.id !== photoId));
        toast.success("写真を削除しました");
      } else {
        toast.error("削除に失敗しました", { description: res.error });
      }
    });
  }

  const aiEnabled = aiProvider !== null;
  const providerLabel =
    aiProvider === "gemini" ? "Google（Gemini）" : "Anthropic（Claude）";
  const valid = date !== "" && name.trim() !== "";
  const busy = isPending || reading;

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
        <MaskEditorDialog
          file={maskTarget}
          providerLabel={providerLabel}
          onCancel={() => setMaskTarget(null)}
          onConfirm={runExtraction}
        />
        <DialogHeader>
          <DialogTitle>{record ? "接種記録を編集" : "接種を記録"}</DialogTitle>
          <DialogDescription>
            {aiEnabled && blobEnabled
              ? "証明書の写真を選ぶと、隠したい部分を塗ってから自動で読み取れます。"
              : "接種した日とワクチン名を記録します。証明書の写真も添付できます。"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
          {suggestions.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                <Sparkles className="size-4" aria-hidden="true" />
                証明書の読み取り結果
              </span>
              <p className="text-xs text-muted-foreground">
                すでに入力がある項目は上書きしていません。使う場合は押してください。
              </p>
              <ul className="flex flex-col gap-1.5">
                {suggestions.map((s) => (
                  <li key={s.field} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{s.label}</span>
                    <span className="flex-1 truncate text-sm">{s.value}</span>
                    <Button variant="outline" size="sm" onClick={() => applySuggestion(s)}>
                      置き換える
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">接種日</span>
            {/* value が YYYY-MM-DD でスキーマと同形 — 変換を挟まない */}
            <Input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setDateTouched(true);
              }}
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
            {/* 読み取り結果はここには入れない。自由記述はPIIの入口になるため */}
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>

          {blobEnabled && (
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <span className="text-sm font-medium">接種証明書の写真</span>

              <PhotoStrip
                photos={photos}
                caption={`${date} ・ ${name || "ワクチン名未入力"}`}
                nested
                onDelete={handleDeletePhoto}
              />

              {pending.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {pending.map((p) => (
                    <li key={p.key} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.previewUrl}
                        alt=""
                        className="size-20 rounded border border-dashed object-cover"
                      />
                      <button
                        type="button"
                        aria-label="この写真をやめる"
                        className="absolute -top-2 -right-2 rounded-full border bg-background p-1 text-muted-foreground hover:text-foreground"
                        onClick={() => removePending(p.key)}
                      >
                        <X className="size-3" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {reading && (
                <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Sparkles className="size-3.5 animate-pulse" aria-hidden="true" />
                  証明書を読み取っています…
                </p>
              )}
              {uploading !== null && (
                <p className="text-xs text-muted-foreground tabular-nums">
                  アップロード中… {Math.round(uploading)}%
                </p>
              )}
              {pending.length > 0 && !reading && uploading === null && (
                <p className="text-xs text-muted-foreground">
                  保存すると{pending.length}枚を添付します。
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
                    onChange={(e) => {
                      handleFiles(e.target.files);
                      // 値を空に戻す。戻さないと、同じ写真をもう一度選んでも
                      // change が発火しない（撮り直しでよく起きる）
                      e.target.value = "";
                    }}
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
                    onChange={(e) => {
                      handleFiles(e.target.files);
                      // 値を空に戻す。戻さないと、同じ写真をもう一度選んでも
                      // change が発火しない（撮り直しでよく起きる）
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>

              {!aiEnabled && (
                <p className="text-xs text-muted-foreground">
                  自動読み取りは未設定です（GEMINI_API_KEY / ANTHROPIC_API_KEY）。
                  写真の添付だけ行えます。
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <DialogClose render={<Button variant="ghost">キャンセル</Button>} />
          <Button disabled={busy || !valid} onClick={handleSave}>
            {isPending ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
