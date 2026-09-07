import { Gift } from "lucide-react";
import Link from "next/link";

import { ImagePreview } from "@/components/image-preview";
import { ImageWithFallback } from "@/components/image-with-fallback";
import { ProductName } from "@/components/product-name";
import { ReceivedBonusDialog } from "@/components/received-bonus-dialog";
import { ReceivedBonusDeleteButton } from "@/components/received-bonus-delete-button";
import {
  BonusPhotoAddBox,
  BonusPhotoButton,
  BonusPhotoStrip,
} from "@/components/received-bonus-photos";
import { MAX_BONUS_PHOTOS } from "@/lib/bonus-photos";
import { formatDate } from "@/lib/format";
import type { OrderWithItems } from "@/lib/queries";
import { buildReceivedDrafts } from "@/lib/received-draft";

/**
 * 届いたおまけ — manually recorded actuals for one order.
 *
 * **このページでおまけを出すのはここだけ。** かつては上の商品一覧（表）にも
 * 同じ行を描き足していたが、同じものが1ページに2回出て何が買ったもので何が
 * おまけか読めなかったので、表は買ったものだけにした（orders/[id]/page.tsx）。
 * 予測（まだ記録が無い注文の「◇◇プレゼント」）も表から移して、下の空の箱に
 * 出している。
 */
export function ReceivedBonusSection({
  order,
  catalogSynced,
}: {
  order: OrderWithItems;
  catalogSynced: boolean;
}) {
  const recorded = order.receivedBonuses;
  const { existing, predicted } = buildReceivedDrafts(order);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="font-heading inline-flex items-center gap-1.5 text-sm font-medium">
          <Gift className="size-4" aria-hidden="true" />
          届いたおまけ
        </h2>
        {order.receivedTotal > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {order.receivedTotal}点
          </span>
        )}
        <div className="ml-auto">
          <ReceivedBonusDialog
            orderId={order.id}
            existing={existing}
            predicted={predicted}
            catalogSynced={catalogSynced}
            trigger={recorded.length > 0 ? "編集" : "おまけを記録"}
          />
        </div>
      </div>

      {recorded.length > 0 ? (
        <>
          <ul className="divide-y rounded-lg border">
            {recorded.map((r) => {
              const srcs = r.photos.map((p) => `/api/bonus-photos/${p.id}`);
              /*
                写真を付けられるのは**商品リストにないおまけだけ**。あちらには
                商品画像があり、絵が2つあると一覧に出るのがどちらか読めない。
                本当の門はサーバ側（attachReceivedBonusPhoto）で、ここは
                ボタンを出すかどうかだけを決める。
              */
              const canAttach = r.productId === null;
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 p-3">
                  {r.photos.length > 0 ? (
                    // 自分で撮った写真は商品画像より先に出す（実際に届いた物）
                    <ImagePreview
                      images={srcs}
                      caption={r.label}
                      title="おまけの写真"
                      className="relative size-12 shrink-0 overflow-hidden rounded border bg-muted"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={srcs[0]}
                        alt=""
                        // 実寸を書いて枠を確保し、画面外は取りに行かない
                        width={48}
                        height={48}
                        loading="lazy"
                        decoding="async"
                        className="size-full object-cover"
                      />
                    </ImagePreview>
                  ) : canAttach ? (
                    // 絵が無い場所をそのまま入口にする（押すとファイル選択）
                    <BonusPhotoAddBox
                      bonusId={r.id}
                      className="size-12 shrink-0 rounded border bg-muted"
                    />
                  ) : (
                    <ImagePreview
                      images={[r.imageUrl]}
                      caption={r.label}
                      className="relative size-12 shrink-0 overflow-hidden rounded border bg-muted"
                    >
                      <ImageWithFallback
                        src={r.imageUrl}
                        alt={r.label}
                        sizes="48px"
                        className="size-full"
                        iconClassName="size-4"
                      />
                    </ImagePreview>
                  )}
                  <div className="min-w-0 flex-1">
                    {r.productId !== null ? (
                      <Link
                        href={`/products/${r.productId}`}
                        className="line-clamp-2 text-sm leading-snug hover:underline"
                      >
                        <ProductName name={r.label} />
                      </Link>
                    ) : (
                      <p className="line-clamp-2 text-sm leading-snug">
                        <ProductName name={r.label} />
                      </p>
                    )}
                    {r.note && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{r.note}</p>
                    )}
                    {/* 何枚あっても全部ここに並べる（1枚目も。左の枠は「この行の
                        絵」で、こちらが編集する場所なので、1枚だけの行から✕が
                        消えてしまわないようにする） */}
                    <BonusPhotoStrip photos={r.photos} caption={r.label} />
                  </div>
                  {/* 数量から先はひとまとまり。狭い画面では li が折り返して
                      この列が2行目に落ちる（名前を潰さないため） */}
                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    <span className="text-sm tabular-nums">×{r.quantity}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatDate(r.createdAt)} 記録
                    </span>
                    {/* 0枚のときは左の枠が入口なので出さない — 1行に上げる
                        入口を2つ置くと、片方で上げている間ももう片方が押せる */}
                    {canAttach && r.photos.length > 0 && (
                      <BonusPhotoButton
                        bonusId={r.id}
                        currentCount={r.photos.length}
                      />
                    )}
                    <ReceivedBonusDeleteButton id={r.id} orderId={order.id} />
                  </div>
                </li>
              );
            })}
          </ul>

          {/*
            消すと戻せないことを言う場所がここしか無い（削除ボタンに確認を
            挟まないのはこのアプリ全体の方針で、記録は入れ直せる。ただし
            写真は撮り直せないので、行を消すと何が消えるかは書いておく）。
          */}
          <p className="text-xs text-muted-foreground">
            写真は「商品リストにない」おまけに{MAX_BONUS_PHOTOS}枚まで、1枚8MBまで。
            削除すると写真そのものも消えます（元に戻せません）。
          </p>
        </>
      ) : (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">まだ記録がありません</p>
          <p className="mt-1 text-xs text-muted-foreground">
            荷物が届いたら、実際に入っていたおまけを記録できます。
            「商品リストにない」おまけには、記録したあと写真を付けられます
            （何をもらったのか、あとから見て分かるように）。
          </p>
          {predicted.length > 0 && (
            /*
              商品一覧の表に出していた「◇◇（プレゼント）」の行をここへ移した。
              出すのは predicted そのもの ＝「予測を取り込む」で入る中身なので、
              見えているものと入るものが一致する。
            */
            <div className="mt-3 inline-flex flex-col items-start gap-0.5 text-left">
              <p className="text-xs font-medium text-muted-foreground">
                予測（この注文に入るはずのもの）
              </p>
              <ul className="text-xs text-muted-foreground">
                {predicted.map((p, i) => (
                  <li key={`${p.label}-${i}`} className="tabular-nums">
                    ・{p.label} ×{p.quantity}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-muted-foreground">
                「おまけを記録」の中の「予測を取り込む」でフォームに入れられます。
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
