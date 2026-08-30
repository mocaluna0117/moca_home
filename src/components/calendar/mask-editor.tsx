"use client";

import { Eraser, ScanText, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * 証明書を読み取りに出す前に、隠したい部分を黒く塗るエディタ。
 *
 * 無料枠の Gemini は規約上、送った内容が Google の製品改善に使われうる
 * （人が見る場合があるとも明記されている）。証明書には飼い主の氏名と住所が
 * 写るので、送る複製にだけ目隠しをかけられるようにする。
 *
 * **保存される写真は塗らない原本のまま。** 塗るのは読み取りに出す複製だけで、
 * 手元の記録としての価値は落とさない。
 */

/** 画像座標を 0〜1 に正規化して持つ。表示倍率と独立させるため */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 読み取りに出す画像の大きさ。文字が潰れない範囲で小さくする */
const OUT_EDGE = 2000;
const OUT_QUALITY = 0.85;

function normalize(r: Rect): Rect {
  return {
    x: Math.min(r.x, r.x + r.w),
    y: Math.min(r.y, r.y + r.h),
    w: Math.abs(r.w),
    h: Math.abs(r.h),
  };
}

export function MaskEditorDialog({
  file,
  onCancel,
  onConfirm,
  providerLabel,
}: {
  /** null のあいだは閉じている */
  file: File | null;
  onCancel: () => void;
  onConfirm: (masked: Blob) => void;
  /** 送り先の名前。どこへ出るのかを画面に出すために受け取る */
  providerLabel: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [rects, setRects] = useState<Rect[]>([]);
  const [drawing, setDrawing] = useState<Rect | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // 別の写真に切り替わったら前回の塗りを持ち越さない。effect ではなく
  // レンダー中に直す（React の推奨する形。既存の SearchInput と同じ）
  const [syncedFile, setSyncedFile] = useState(file);
  if (file !== syncedFile) {
    setSyncedFile(file);
    setRects([]);
    setDrawing(null);
    setBusy(false);
    setFailed(false);
    // 前の画像を残したまま次を描かない
    setBitmap(null);
  }

  // 画像の読み込み。EXIF の回転を保つ指定は保存用と揃える
  useEffect(() => {
    if (!file) return;
    let alive = true;
    createImageBitmap(file, { imageOrientation: "from-image" })
      .then((b) => {
        // **state に入れたビットマップは close() しない。**
        // cleanup で閉じると、描画 effect が閉じた後のものを drawImage して
        // "The image source is detached" で落ち、例外がツリーごと巻き込んで
        // 記録ダイアログまで閉じてしまう。使い終わりは GC に任せる
        // （1回のダイアログで数枚しか作らない）。
        if (alive) setBitmap(b);
        else b.close();
      })
      .catch(() => {
        // HEIC を decode できないブラウザなど。読み取りは諦めて手入力に落とす
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [file]);

  // 画像と塗りを描く。state は触らないので effect で問題ない
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bitmap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    try {
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    } catch {
      // 何かの拍子に使えなくなったビットマップで画面全体を落とさない
      return;
    }
    ctx.fillStyle = "#000";
    const all = drawing ? [...rects, normalize(drawing)] : rects;
    for (const r of all) {
      ctx.fillRect(r.x * canvas.width, r.y * canvas.height, r.w * canvas.width, r.h * canvas.height);
    }
  }, [bitmap, rects, drawing]);

  function pointOf(e: React.PointerEvent<HTMLCanvasElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    return {
      x: (e.clientX - box.left) / box.width,
      y: (e.clientY - box.top) / box.height,
    };
  }

  function handleDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointOf(e);
    setDrawing({ x: p.x, y: p.y, w: 0, h: 0 });
  }

  function handleMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing) return;
    const p = pointOf(e);
    setDrawing({ ...drawing, w: p.x - drawing.x, h: p.y - drawing.y });
  }

  function handleUp() {
    if (!drawing) return;
    const r = normalize(drawing);
    setDrawing(null);
    // 指が滑っただけの点は塗りにしない
    if (r.w > 0.01 && r.h > 0.01) setRects((prev) => [...prev, r]);
  }

  /** 塗りを反映した JPEG を作って返す */
  async function emit(withMask: boolean) {
    if (!bitmap) return;
    setBusy(true);
    try {
      const scale = Math.min(1, OUT_EDGE / Math.max(bitmap.width, bitmap.height));
      const w = Math.round(bitmap.width * scale);
      const h = Math.round(bitmap.height * scale);
      const out = document.createElement("canvas");
      out.width = w;
      out.height = h;
      const ctx = out.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(bitmap, 0, 0, w, h);
      if (withMask) {
        ctx.fillStyle = "#000";
        for (const r of rects) ctx.fillRect(r.x * w, r.y * h, r.w * w, r.h * h);
      }
      const blob = await new Promise<Blob | null>((res) =>
        out.toBlob(res, "image/jpeg", OUT_QUALITY),
      );
      if (blob) onConfirm(blob);
    } finally {
      setBusy(false);
    }
  }

  // 表示用のキャンバスは長辺 900px 相当。塗りは正規化座標なので精度は落ちない
  const displayW = bitmap ? Math.min(900, bitmap.width) : 0;
  const displayH = bitmap ? Math.round((bitmap.height / bitmap.width) * displayW) : 0;

  return (
    <Dialog
      open={file !== null}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent
        className="sm:max-w-3xl"
        // 記録ダイアログの上に重なる。Base UI は入れ子の背景を描かないので
        // forceRender で自前の暗幕を出す
        overlayProps={{ forceRender: true, className: "bg-black/60" }}
      >
        <DialogHeader>
          <DialogTitle>送る前に隠す</DialogTitle>
          <DialogDescription>
            読み取りのため、この画像を{providerLabel}に送ります。
            飼い主名・住所など送りたくない部分をなぞって黒く塗ってください。
            <strong className="font-medium">保存される写真は塗られません。</strong>
          </DialogDescription>
        </DialogHeader>

        {failed ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            この画像はブラウザで開けないため、自動読み取りに使えません。
            <br />
            写真の添付はできます。項目は手入力してください。
          </p>
        ) : !bitmap ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            画像を読み込んでいます…
          </p>
        ) : (
          <div className="flex max-h-[55vh] justify-center overflow-auto rounded border bg-muted">
            <canvas
              ref={canvasRef}
              width={displayW}
              height={displayH}
              onPointerDown={handleDown}
              onPointerMove={handleMove}
              onPointerUp={handleUp}
              onPointerCancel={handleUp}
              // 指でなぞるときにページがスクロールしないように
              className="max-w-full cursor-crosshair touch-none"
              aria-label="隠したい部分をなぞってください"
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={rects.length === 0}
            onClick={() => setRects((r) => r.slice(0, -1))}
          >
            <Undo2 aria-hidden="true" />
            ひとつ戻す
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={rects.length === 0}
            onClick={() => setRects([])}
          >
            <Eraser aria-hidden="true" />
            全部消す
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">
            {rects.length > 0 ? `${rects.length}か所を目隠し` : "まだ塗っていません"}
          </span>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            読み取らない
          </Button>
          <Button onClick={() => emit(true)} disabled={busy || !bitmap || failed}>
            <ScanText aria-hidden="true" />
            {rects.length > 0 ? "この状態で読み取る" : "このまま読み取る"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
