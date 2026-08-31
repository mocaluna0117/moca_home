"use client";

import { PawPrint, PencilLine } from "lucide-react";
import { useState, type ReactNode } from "react";

import { ProfileDialog } from "@/components/home/profile-dialog";
import { Button } from "@/components/ui/button";
import type { DateStr } from "@/lib/calendar";
import type { DogProfile } from "@/lib/db/schema";
import { DEFAULT_DOG_NAME } from "@/lib/profile";

/**
 * ヒーローの丸写真と、その隣に立てるテキスト列（children）。
 *
 * client なのは2つの理由だけ:
 *  1. `<img onError>` — private blob の取得が落ちる（トークンを消した・ストアを
 *     作り直した）ことは描いてみるまで分からないので、破線の丸へ落とすのは
 *     ブラウザでしかできない。
 *  2. 丸写真と「プロフィールを作る」の2つのトリガーが1つのダイアログの
 *     open state を共有する。
 *
 * テキストは children として受ける。年齢・記念日・体重の文字列は
 * getHomeSnapshot が作り終えてから降りてくるので、こうすると
 * ヒーロー本体（MocaHero）は Server Component のままでいられる。
 *
 * `today` はこの枠自身では使わず、ProfileDialog へ素通しする。ダイアログは
 * 年齢のプレビューと日付入力の max に使う。中で new Date() を呼ばないのは
 * src/lib/profile.ts の作法（「今日」は必ず引数で受ける）— クライアントの
 * 時計で決めると、ヒーローの年齢と1日ずれる日ができる。
 */
export function ProfileFrame({
  profile,
  photoSrc,
  blobEnabled,
  today,
  children,
}: {
  profile: DogProfile | null;
  photoSrc: string | null;
  blobEnabled: boolean;
  today: DateStr;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  /**
   * 開くたびに1つ進めて、ダイアログを key で作り直す。ダイアログ側は
   * props から初期値を作るだけでよくなり、「開いたら入力を戻す」処理を
   * 持たずに済む（mount したままなので閉じるアニメーションは消えない）。
   */
  const [generation, setGeneration] = useState(0);
  /**
   * 取得に失敗した src を覚えるだけ。effect で state を戻さないのは、
   * 写真を差し替えれば ?v= が変わって別の src になり、そこで自然に
   * もう一度試されるから（photo-strip の「索引が範囲外なら閉じている扱い」と同じ作法）。
   */
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const src = photoSrc !== null && photoSrc !== failedSrc ? photoSrc : null;
  // 行がまだ無いときの名前は DEFAULT_DOG_NAME 1箇所から取る
  const name = profile?.name ?? DEFAULT_DOG_NAME;

  function openDialog() {
    setGeneration((n) => n + 1);
    setOpen(true);
  }

  return (
    <>
      <div className="flex items-start gap-3 sm:gap-4">
        {/*
          丸写真そのものが編集のトリガー。Blob 未設定でも（＝写真を出せなくても）
          押せるままにするのは、ここが唯一の「プロフィールを開く」入口だから。
          写真を足す導線はダイアログの中だけにあり、Blob 未設定なら消える。
        */}
        <button
          type="button"
          onClick={openDialog}
          aria-label={`${name}のプロフィールを${profile === null ? "作る" : "編集"}`}
          className="relative size-24 shrink-0 rounded-full outline-none transition-opacity hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50 sm:size-32"
        >
          {src !== null ? (
            // next/image は使わない。/api/dog-photo は private blob の中継で、
            // 最適化サーバに取りに行かせる相手ではない
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              // ボタンの aria-label が名前を持っているので alt は空にする
              alt=""
              onError={() => setFailedSrc(src)}
              className="size-full rounded-full bg-muted object-cover"
            />
          ) : (
            // 写真が無い・出せない・落ちた、のどれでも同じ丸。高さが変わらないので
            // ヒーローのレイアウトは崩れない
            <span className="flex size-full items-center justify-center rounded-full border-2 border-dashed bg-muted/30 text-muted-foreground">
              <PawPrint className="size-8 sm:size-10" aria-hidden="true" />
            </span>
          )}
          {/* 行があるときだけの小さな鉛筆。行が無いときは下の「作る」ボタンが
              同じことを言うので、2つ出さない */}
          {profile !== null && (
            <span className="absolute -right-1 -bottom-1 rounded-full border bg-background p-1.5 text-muted-foreground">
              <PencilLine className="size-3.5" aria-hidden="true" />
            </span>
          )}
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {children}
          {/* 行が無いときだけ。写真の鉛筆は小さすぎて「まだ作っていない」人には
              押す物に見えないので、文字のボタンを children の下に足す */}
          {profile === null && (
            <div className="mt-2">
              <Button variant="outline" size="sm" onClick={openDialog}>
                <PencilLine aria-hidden="true" />
                プロフィールを作る
              </Button>
            </div>
          )}
        </div>
      </div>

      <ProfileDialog
        key={generation}
        open={open}
        onOpenChange={setOpen}
        profile={profile}
        blobEnabled={blobEnabled}
        today={today}
      />
    </>
  );
}
