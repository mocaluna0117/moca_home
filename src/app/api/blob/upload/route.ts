import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

import {
  ALLOWED_PHOTO_TYPES,
  BLOB_PREFIX,
  MAX_PHOTO_BYTES,
  isBlobConfigured,
} from "@/lib/blob";

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
        // トークンは vaccinations/ 配下にしか書けない
        if (!pathname.startsWith(BLOB_PREFIX)) {
          throw new Error("保存先が不正です");
        }
        return {
          allowedContentTypes: [...ALLOWED_PHOTO_TYPES],
          maximumSizeInBytes: MAX_PHOTO_BYTES,
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
