import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

import { PHOTO_RULES, isBlobConfigured, parseBlobPath } from "@/lib/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * クライアント直アップロードのトークンを発行する。
 *
 * ブラウザ → Blob の直行にするのは、Vercel の Function がリクエストボディ
 * 4.5MB 上限で、スマホ写真（3〜12MB）がそれを超えるため。Server Action も
 * 同じ制限下にあるので、経路自体を分ける必要がある。
 *
 * このルートは middleware の認証ゲートの内側にあるので、ログイン済みの
 * ブラウザからしかトークンを取得できない。
 */
export async function POST(request: Request) {
  if (!isBlobConfigured()) {
    return NextResponse.json(
      {
        error:
          "写真の保存先（Vercel Blob）が未設定です。Vercel の Storage で Blob ストアを作成してください。",
      },
      { status: 501 },
    );
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // 用途は接頭辞の**許可リスト**で決める（vaccinations/ か profile/）。
        // 「どちらでもよい」と条件を緩める書き方にはしない — ここは
        // トークン発行の唯一の関門で、緩める側の変更は必ず穴になる。
        // 判定できない pathname はトークンを出さずに落とす（従来どおり）。
        const parsed = parseBlobPath(pathname);
        if (!parsed) throw new Error("保存先が不正です");
        // 受け入れる形式と上限は用途ごとに違う（profile は HEIC を受けず 8MB）。
        // ここで縛るので、Server Action 側は client 由来のメタデータを
        // 二重に確かめるだけでよくなる。
        const rules = PHOTO_RULES[parsed.kind];
        return {
          allowedContentTypes: [...rules.types],
          maximumSizeInBytes: rules.maxBytes,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {
        // 使わない。DB への書き込みは upload() 解決後にクライアントが
        // Server Action を呼ぶ（このコールバックはローカルに届かず、
        // 本番でも cookie を持たないので middleware に 401 で弾かれる）。
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "アップロードに失敗しました" },
      { status: 400 },
    );
  }
}
