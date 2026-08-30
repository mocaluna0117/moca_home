import { NextResponse } from "next/server";

import {
  MAX_VISION_BYTES,
  extractVaccinationFromImage,
  isAiConfigured,
  isVisionMediaType,
} from "@/lib/ai";
import { todayJst } from "@/lib/calendar";
import { nowJstIso } from "@/lib/format";
import { normalizeExtraction } from "@/lib/vaccination-extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Hobby は 1〜300 秒。SDK 側は timeout 25 秒 × 再試行1回に絞ってある
export const maxDuration = 60;

/**
 * 証明書の画像から接種情報を読み取る。
 *
 * **画像そのものを受け取る。** Blob の pathname や URL は受け取らない。
 * それらを引数にすると、このエンドポイントが「ストア内の任意の画像を
 * 読み上げる関数」になり、生バイトを返さなくても内容が漏れるため。
 * 記録を保存する前でも使いたい（保存前は写真にDBのidが無い）という要件も、
 * 画像を直接受け取る形なら素直に満たせる。
 *
 * middleware の認証ゲートの内側にある。返すのは正規化済みの4項目だけで、
 * DBには何も書かない（保存ボタンを押すのは人）。
 */
export async function POST(request: Request) {
  if (!isAiConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "画像の読み取り（ANTHROPIC_API_KEY）が未設定です。手入力で記録できます。",
      },
      { status: 501 },
    );
  }

  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    if (value instanceof File) file = value;
  } catch {
    return NextResponse.json({ ok: false, error: "画像を受け取れませんでした" }, { status: 400 });
  }

  if (!file) {
    return NextResponse.json({ ok: false, error: "画像がありません" }, { status: 400 });
  }
  if (!isVisionMediaType(file.type)) {
    return NextResponse.json(
      { ok: false, error: "この画像形式は読み取りに対応していません" },
      { status: 415 },
    );
  }
  if (file.size < 1 || file.size > MAX_VISION_BYTES) {
    return NextResponse.json({ ok: false, error: "画像のサイズが不正です" }, { status: 413 });
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const result = await extractVaccinationFromImage(base64, file.type);

  if (!result.ok) {
    // 失敗の手がかりを画面にも出す。ステータスと種別だけなので証明書の中身は乗らない
    const hint = result.detail ? `（${result.detail}）` : "";
    const message =
      result.reason === "rate-limited"
        ? "読み取りが混み合っています。少し待ってからもう一度お試しください。"
        : result.reason === "unauthorized"
          ? "画像の読み取りの設定に問題があります（APIキー）。"
          : result.reason === "unreadable"
            ? "証明書を読み取れませんでした。手入力してください。"
            : "画像の読み取りに失敗しました。手入力してください。";
    // 429 は再試行してよいことが伝わるステータスにする
    const status = result.reason === "rate-limited" ? 429 : 502;
    return NextResponse.json({ ok: false, error: message + hint }, { status });
  }

  const fields = normalizeExtraction(result.raw, todayJst(nowJstIso()));
  return NextResponse.json({ ok: true, fields }, { headers: { "Cache-Control": "no-store" } });
}
