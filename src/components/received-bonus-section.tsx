import { Gift } from "lucide-react";
import Link from "next/link";

import { ImagePreview } from "@/components/image-preview";
import { ImageWithFallback } from "@/components/image-with-fallback";
import { ProductName } from "@/components/product-name";
import { ReceivedBonusDialog } from "@/components/received-bonus-dialog";
import { ReceivedBonusDeleteButton } from "@/components/received-bonus-delete-button";
import { ReceivedBonusPhotoButton } from "@/components/received-bonus-photo-button";
import { formatDate } from "@/lib/format";
import type { OrderWithItems } from "@/lib/queries";
import { buildReceivedDrafts } from "@/lib/received-draft";

/** 届いたおまけ — manually recorded actuals for one order. */
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
        <ul className="divide-y rounded-lg border">
          {recorded.map((r) => {
            /*
              自分で付けた写真は商品画像より**先**に出す。カタログの写真は
              「その商品はこういうもの」で、こちらは「実際に届いたもの」。
              自由入力の行にはそもそも商品画像が無い（この機能の目的）。
              ?v= は差し替えたときに古い写真を出さないためのキャッシュ破り。
            */
            const photoSrc = r.hasPhoto
              ? `/api/bonus-photos/${r.id}?v=${encodeURIComponent(r.photoUpdatedAt ?? "")}`
              : null;
            return (
            <li key={r.id} className="flex flex-wrap items-center gap-3 p-3">
              <ImagePreview
                images={photoSrc !== null ? [photoSrc] : r.productId !== null ? [r.imageUrl] : []}
                caption={r.label}
                title={photoSrc !== null ? "おまけの写真" : undefined}
                className="relative size-12 shrink-0 overflow-hidden rounded border bg-muted"
              >
                {photoSrc !== null ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photoSrc}
                    alt=""
                    // 実寸を書いて枠を確保し、画面外は取りに行かない
                    width={48}
                    height={48}
                    loading="lazy"
                    decoding="async"
                    className="size-full object-contain"
                  />
                ) : r.productId !== null ? (
                  <ImageWithFallback
                    src={r.imageUrl}
                    alt={r.label}
                    sizes="48px"
                    className="size-full"
                    iconClassName="size-4"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center">
                    <Gift
                      className="size-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </div>
                )}
              </ImagePreview>
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
              </div>
              {/* 数量から先はひとまとまり。狭い画面では li が折り返して
                  この列が2行目に落ちる（名前を潰さないため） */}
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <span className="text-sm tabular-nums">×{r.quantity}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatDate(r.createdAt)} 記録
                </span>
                <ReceivedBonusPhotoButton bonusId={r.id} hasPhoto={r.hasPhoto} />
                <ReceivedBonusDeleteButton id={r.id} orderId={order.id} />
              </div>
            </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">まだ記録がありません</p>
          <p className="mt-1 text-xs text-muted-foreground">
            荷物が届いたら、実際に入っていたおまけを記録できます。記録したあと、
            1件ずつ写真を付けられます（商品リストにないおまけも見て分かるように）。
            {predicted.length > 0 &&
              "「予測を取り込む」でフォームに予測内容をセットできます。"}
          </p>
        </div>
      )}
    </section>
  );
}
