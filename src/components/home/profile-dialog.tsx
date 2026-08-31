"use client";

import { upload } from "@vercel/blob/client";
import { Camera, ImagePlus, Trash2 } from "lucide-react";
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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  discardUnattachedDogPhoto,
  removeDogPhoto,
  saveDogProfile,
  setDogPhoto,
} from "@/lib/actions-profile";
import { isDateOnly, type DateStr } from "@/lib/calendar";
import { callAction } from "@/lib/call-action";
import type { DogProfile } from "@/lib/db/schema";
import { PhotoConvertError, preparePhoto, type PreparedPhoto } from "@/lib/prepare-photo";
import {
  DEFAULT_DOG_NAME,
  DOG_SEXES,
  MAX_BREED_LENGTH,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_WEIGHT_G,
  MIN_WEIGHT_G,
  SEX_LABEL,
  ageLabel,
  formatWeight,
  parseWeightKg,
  type DogSex,
} from "@/lib/profile";
import { cn } from "@/lib/utils";

/**
 * もかのプロフィールの編集。**制御ダイアログ**で、open は親（ProfileFrame）が持つ
 * — 丸写真と「プロフィールを作る」の2つのトリガーが同じダイアログを開けるため
 * （DialogTrigger を使うと開ける口が1つに限られる。photo-strip.tsx と同じ形）。
 *
 * 入力の初期値は props からそのまま作る。「開いたら入力を戻す」処理を持たないのは、
 * 親が開くたびに key を進めてこのコンポーネントを作り直すから（ProfileFrame の
 * generation を参照）。
 *
 * 検証の本体は Server Action（src/lib/actions-profile.ts）。ここが持つのは
 * maxLength と「押しても必ず失敗する状態で保存を押させない」ぶんだけで、
 * 文言は actions-profile.ts が返すものをそのまま toast の description に出す
 * （同じ日本語を2箇所で書き分けない）。
 */
export function ProfileDialog({
  open,
  onOpenChange,
  profile,
  blobEnabled,
  today,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * 「今日」は必ず引数で受ける（src/lib/profile.ts の作法）。年齢のプレビューと
   * 日付入力の max に使うだけで、ここで new Date() は絶対に呼ばない —
   * 呼ぶとサーバが決めた「今日」とクライアントの時計が食い違い、
   * ヒーローの年齢とダイアログの年齢が1日ずれる日ができる。
   */
  today: DateStr;
  profile: DogProfile | null;
  blobEnabled: boolean;
}) {
  // 名前の既定は DEFAULT_DOG_NAME 1箇所から取る。ヒーローが既に「もか」と
  // 出しているので、作るときの初期値もそれに合わせる（別の既定を生やさない）
  const [name, setName] = useState(profile?.name ?? DEFAULT_DOG_NAME);
  const [breed, setBreed] = useState(profile?.breed ?? "");
  const [sex, setSex] = useState<DogSex | null>(profile?.sex ?? null);
  const [birthday, setBirthday] = useState(profile?.birthday ?? "");
  const [cameHomeOn, setCameHomeOn] = useState(profile?.cameHomeOn ?? "");
  const [weightKg, setWeightKg] = useState(kgInput(profile?.weightGrams ?? null));
  const [weighedOn, setWeighedOn] = useState(profile?.weighedOn ?? "");
  const [note, setNote] = useState(profile?.note ?? "");
  const [pending, setPending] = useState<PendingPhoto | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  // 「写真を消す」は即時に効く。行が指している写真が消えたことを
  // revalidate の到着より前に画面へ出すために、ここでも覚えておく
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    // 閉じた時点ではまだ何も上がっていない（保存のときにだけ上げる）ので、
    // プレビューを解放するだけでよい
    if (!next) discardPending();
    onOpenChange(next);
  }

  function discardPending() {
    if (pending) URL.revokeObjectURL(pending.previewUrl);
    setPending(null);
  }

  /** 写真は1枚だけ。選び直しは常に前のプレビューを解放してから差し替える */
  function choosePhoto(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (pending) URL.revokeObjectURL(pending.previewUrl);
    setPending({ file, previewUrl: URL.createObjectURL(file) });
  }

  /**
   * 保存。順序が要 —
   * 1. saveDogProfile で**行を先に**作る（setDogPhoto は行が無いと失敗するし、
   *    キャンセルした時点ではまだ何も上がっていないので孤児 blob が生まれない）
   * 2. ブラウザで縮小。変換できなければ**上げずに**終わる
   * 3. Blob へ直アップロード
   * 4. setDogPhoto でメタデータを行へ
   * 5. 4 が失敗したら discardUnattachedDogPhoto で上げた実体を戻す
   */
  function handleSave() {
    startTransition(async () => {
      const saved = await callAction(() =>
        saveDogProfile({
          name,
          breed: breed.trim() || null,
          sex,
          birthday: birthday.trim() || null,
          cameHomeOn: cameHomeOn.trim() || null,
          weightKg: weightKg.trim() || null,
          weighedOn: weighedOn.trim() || null,
          note: note.trim() || null,
        }),
      );
      if (!saved.ok) {
        toast.error("保存に失敗しました", { description: saved.error });
        return;
      }
      if (!pending) {
        toast.success("プロフィールを保存しました");
        handleOpenChange(false);
        return;
      }

      let prepared: PreparedPhoto;
      try {
        // 丸枠は最大128pxでしか出ないので 1200px で足りる。
        // allowOriginalFallback: false は「変換できなかった原本を送らない」——
        // HEIC を <img> で描けないブラウザがあり、顔写真が出ないのは
        // 証明書のサムネイルが出ないのとは重みが違う
        prepared = await preparePhoto(pending.file, {
          maxEdge: 1200,
          allowOriginalFallback: false,
        });
      } catch (err) {
        // 文字の項目は保存できている。写真を選び直せるように**閉じない**
        if (err instanceof PhotoConvertError) {
          toast.error("この写真は変換できませんでした", {
            description: "別の写真をえらんでください。JPEG・PNG・WebP に対応しています。",
          });
        } else {
          photoFailedToast();
        }
        return;
      }

      setUploading(0);
      let uploaded: string | null = null;
      try {
        const blob = await upload(`profile/${crypto.randomUUID()}.jpg`, prepared.body, {
          // ストアは private。表示は同一オリジンの /api/dog-photo 経由で、
          // Blob の URL は誰も直接開けない（列にも保存しない）
          access: "private",
          contentType: prepared.contentType,
          handleUploadUrl: "/api/blob/upload",
          onUploadProgress: ({ percentage }) => setUploading(percentage),
        });
        uploaded = blob.pathname;
        const attached = await callAction(() =>
          setDogPhoto({
            url: blob.url,
            pathname: blob.pathname,
            contentType: prepared.contentType,
            sizeBytes: prepared.body.size,
          }),
        );
        if (!attached.ok) {
          // Blob には載ったのに行がどこも指していない状態を残さない
          await callAction(() => discardUnattachedDogPhoto(blob.pathname));
          photoFailedToast();
          return;
        }
      } catch {
        if (uploaded) {
          // narrowing を閉じ込みで失わないように控える（vaccination-dialog と同じ）
          const orphan = uploaded;
          await callAction(() => discardUnattachedDogPhoto(orphan));
        }
        photoFailedToast();
        return;
      } finally {
        setUploading(null);
      }

      toast.success("写真を差し替えました");
      handleOpenChange(false);
    });
  }

  function handleRemovePhoto() {
    startTransition(async () => {
      const res = await callAction(() => removeDogPhoto());
      if (res.ok) {
        setPhotoRemoved(true);
        toast.success("写真を消しました");
      } else {
        toast.error("削除に失敗しました", { description: res.error });
      }
    });
  }

  const grams = weightKg.trim() === "" ? null : parseWeightKg(weightKg);
  const weightBroken = weightKg.trim() !== "" && grams === null;
  // 体重と測定日は2列で1つの事実。「いつの値か」が無い体重は保存させない
  const weightNeedsDate = grams !== null && weighedOn.trim() === "";
  const weightProblem = weightBroken || weightNeedsDate;
  // 読めているあいだは「保存したらこう出る」を見せる（formatWeight は
  // ヒーローと同じ関数なので、プレビューと本番の文字列が食い違わない）
  const weightHint = weightBroken
    ? `体重は ${MIN_WEIGHT_G / 1000}〜${MAX_WEIGHT_G / 1000}kg の範囲で入力してください`
    : weightNeedsDate
      ? "体重を入れるときは、はかった日も入れてください"
      : formatWeight(grams, isDateOnly(weighedOn) ? weighedOn : null);

  // 入力途中の空文字・未完成の日付では null が返るので、そのまま行を出さない
  const agePreview = ageLabel(isDateOnly(birthday) ? birthday : null, today);

  const hasPhoto = !photoRemoved && Boolean(profile?.photoPathname);
  const busy = isPending;
  const canSave = name.trim() !== "" && !weightProblem;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{profile?.name ?? DEFAULT_DOG_NAME}のプロフィール</DialogTitle>
          <DialogDescription>
            ホームのいちばん上に出ます。空けたままの項目があっても大丈夫です。
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">なまえ</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_NAME_LENGTH}
              required
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">犬種（任意）</span>
            {/* マスタは持たない。自由入力のまま保存する */}
            <Input
              value={breed}
              onChange={(e) => setBreed(e.target.value)}
              maxLength={MAX_BREED_LENGTH}
              placeholder="例: トイプードル"
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span id="profile-sex-label" className="text-sm font-medium">
              性別（任意）
            </span>
            {/* 値とラベルは src/lib/profile.ts の DOG_SEXES / SEX_LABEL が唯一の出所。
                「えらばない」= null なので、一度選んでも空に戻せる */}
            <div
              role="group"
              aria-labelledby="profile-sex-label"
              className="flex flex-wrap gap-2"
            >
              {DOG_SEXES.map((value) => (
                <Button
                  key={value}
                  variant={sex === value ? "default" : "outline"}
                  aria-pressed={sex === value}
                  onClick={() => setSex(value)}
                >
                  {SEX_LABEL[value]}
                </Button>
              ))}
              <Button
                variant={sex === null ? "default" : "outline"}
                aria-pressed={sex === null}
                onClick={() => setSex(null)}
              >
                えらばない
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">たんじょうび（任意）</span>
              {/* value が YYYY-MM-DD でスキーマと同形 — 変換を挟まない */}
              <Input
                type="date"
                value={birthday}
                // Action も「今日より後」を弾くが、弾かれてから知るより
                // カレンダーで選べない方が早い（検証の代わりではなく前段）
                max={today}
                onChange={(e) => setBirthday(e.target.value)}
              />
              {/*
                入れた日から出る年齢をその場で見せる。ageLabel はヒーローの
                meta を作っているのと同じ関数なので、プレビューと保存後の
                表示が食い違わない。読めない日付のときは何も出さない。
              */}
              {agePreview !== null && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  いま {agePreview}
                </span>
              )}
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">おうちに来た日（任意）</span>
              <Input
                type="date"
                max={today}
                value={cameHomeOn}
                onChange={(e) => setCameHomeOn(e.target.value)}
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">体重（任意）</span>
              <span className="flex items-center gap-1.5">
                {/* 全角の「５．２」も parseWeightKg が受けるので、
                    inputMode は使い勝手のためだけ（入力を縛らない） */}
                <Input
                  value={weightKg}
                  onChange={(e) => setWeightKg(e.target.value)}
                  inputMode="decimal"
                  placeholder="例: 5.2"
                  className="max-w-24"
                />
                <span className="text-sm text-muted-foreground">kg</span>
              </span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">体重をはかった日（任意）</span>
              <Input
                type="date"
                value={weighedOn}
                onChange={(e) => setWeighedOn(e.target.value)}
              />
            </label>
          </div>
          {weightHint && (
            <p
              className={cn(
                "text-xs",
                weightProblem ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {weightHint}
            </p>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">ひとこと（任意）</span>
            {/* このページを「道具」ではなく「ホームページ」にしている唯一の自由文 */}
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={MAX_NOTE_LENGTH}
              placeholder="例: 散歩よりおやつが好き"
            />
          </label>

          {/* Blob 未設定のときは写真ブロックを丸ごと出さない。注意書きも出さない
              — 設定できない人に設定の話をしても打つ手が無いし、文字だけで
              プロフィールは完成する（接種ダイアログと同じ振る舞い） */}
          {blobEnabled && (
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <span className="text-sm font-medium">写真</span>

              {pending && (
                <div className="flex items-center gap-3">
                  {/* 保存前のプレビュー。丸で出すのは、ヒーローでどう切り抜かれるかを
                      選んだ直後に見せるため */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={pending.previewUrl}
                    alt=""
                    className="size-20 shrink-0 rounded-full border border-dashed object-cover"
                  />
                  <p className="text-xs text-muted-foreground">
                    まんなかを丸く切り抜いて表示します。
                  </p>
                </div>
              )}

              {uploading !== null && (
                <p className="text-xs text-muted-foreground tabular-nums">
                  アップロード中… {Math.round(uploading)}%
                </p>
              )}
              {pending && uploading === null && (
                <p className="text-xs text-muted-foreground">
                  保存すると写真を差し替えます。
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
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
                      choosePhoto(e.target.files);
                      // 値を空に戻す。戻さないと、同じ写真をもう一度選んでも
                      // change が発火しない（撮り直しでよく起きる）
                      e.target.value = "";
                    }}
                  />
                </label>
                <label className="cursor-pointer">
                  <span className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm">
                    <ImagePlus className="size-4" aria-hidden="true" />
                    写真をえらぶ
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => {
                      choosePhoto(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
                {/* 選んだ写真があるあいだは出さない。「消す」と「差し替える」を
                    同時に押せると、どちらが残るのか押した人に分からない */}
                {hasPhoto && !pending && (
                  <Button variant="destructive" disabled={busy} onClick={handleRemovePhoto}>
                    <Trash2 aria-hidden="true" />
                    写真を消す
                  </Button>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                この写真はこのアプリの中だけで見られます。
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <DialogClose render={<Button variant="ghost">キャンセル</Button>} />
          <Button disabled={busy || !canSave} onClick={handleSave}>
            {busy ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 写真だけが失敗したときの1つの言い方。文字の項目は保存できているので、
 * 「保存に失敗した」と読める文言にはしない（3箇所から同じことを言う）。
 */
function photoFailedToast(): void {
  toast.error("写真の差し替えに失敗しました", {
    description: "プロフィールは保存されています。もう一度お試しください。",
  });
}

/** 保存前に選んだ写真。アップロードは「保存」を押して行ができてから行う */
interface PendingPhoto {
  file: File;
  previewUrl: string;
}

/**
 * グラム → 入力欄の「5.2」。
 *
 * 表示の文字列は formatWeight が持つが、それは「5.2kg（6月1日に測定）」なので
 * input の value には使えない。ここは初期値を戻すためだけの逆変換で、
 * kg → グラムは今も parseWeightKg の一本道（打った値と保存される値がずれる
 * 経路を増やさない）。
 */
function kgInput(weightGrams: number | null): string {
  if (weightGrams === null) return "";
  return String(Math.round(weightGrams / 100) / 10);
}
