/**
 * ブラウザ専用モジュール。createImageBitmap / document / canvas を直接触るので、
 * サーバファイル（"use server" や server-only のモジュール）から import しては
 * いけない。`import "client-only"` で機械的に縛りたいところだが、client-only は
 * package.json に無い（next の推移的依存でしかない）ため、境界はこのコメントで守る。
 *
 * 中身は証明書ダイアログに private だった prepare() をそのまま持ち出したもの。
 * 引数なしで呼べば当時と1文字も違わない挙動になる（EXIF 回転・HEIC の
 * フォールバック・1.5MB 未満の再エンコード回避は実機の iPhone 写真で詰めた値なので、
 * 既定値は動かさない）。
 */

/**
 * 変換できなかったことを呼び出し側が握れるようにする。
 * 原本をそのまま送るかどうかは用途で変わる（証明書は送る、プロフィールは送らない）ので、
 * その判断をこのモジュールに持たせない。
 */
export class PhotoConvertError extends Error {}

export interface PreparedPhoto {
  body: Blob | File;
  contentType: string;
  width: number | null;
  height: number | null;
}

export interface PreparePhotoOptions {
  maxEdge?: number;
  quality?: number;
  skipBelowBytes?: number;
  /** false なら変換失敗時に原本を返さず PhotoConvertError を投げる */
  allowOriginalFallback?: boolean;
}

const MAX_EDGE = 2000;
const QUALITY = 0.82;
/** これより小さい画像は再エンコードしない（世代劣化を避ける） */
const SKIP_BELOW_BYTES = 1.5 * 1024 * 1024;
/** そのまま保存してよい形式。HEIC は Chrome / Firefox が <img> で描けない */
const KEEP_AS_IS = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * アップロード前にブラウザで縮小する。スマホ写真は 3〜12MB あり、
 * そのままだと回線と保存容量を無駄に使う。
 * 失敗した場合（HEIC を decode できない・低メモリ端末）は既定では原本をそのまま
 * 送る — 直アップロードなのでサイズ上限に引っかからない。
 * 原本を送ると困る用途（描けない形式が画面の主役になる場合）は
 * allowOriginalFallback: false を渡して PhotoConvertError を受け取る。
 */
export async function preparePhoto(
  file: File,
  opts: PreparePhotoOptions = {},
): Promise<PreparedPhoto> {
  const {
    maxEdge = MAX_EDGE,
    quality = QUALITY,
    skipBelowBytes = SKIP_BELOW_BYTES,
    allowOriginalFallback = true,
  } = opts;

  // 小さくても HEIC は通さない。通すと一覧のサムネイルが出ない端末がある
  if (file.size < skipBelowBytes && KEEP_AS_IS.has(file.type)) {
    return { body: file, contentType: file.type, width: null, height: null };
  }
  try {
    // imageOrientation を指定しないと iPhone の縦写真が横倒しになる
    // （canvas は EXIF の回転情報を落とすため）
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, "image/jpeg", quality),
    );
    if (!blob) throw new Error("encode failed");
    return { body: blob, contentType: "image/jpeg", width: w, height: h };
  } catch {
    if (!allowOriginalFallback) {
      throw new PhotoConvertError("この写真は変換できませんでした");
    }
    return { body: file, contentType: file.type || "image/jpeg", width: null, height: null };
  }
}
