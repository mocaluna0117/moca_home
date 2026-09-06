import { MedicineSection } from "@/components/care/medicine-section";
import { isBlobConfigured } from "@/lib/blob";
import { getMedicines } from "@/lib/queries-care";

export const dynamic = "force-dynamic";

/**
 * 薬の登録。フィラリアの予定から選ぶ候補になる。
 *
 * blobEnabled を渡すのは、写真の添付を出すかどうかをここで決めるため
 * （未設定なら名前だけの登録として今までどおり使える）。
 */
export default async function MedicinesPage() {
  return (
    <MedicineSection
      medicines={await getMedicines()}
      blobEnabled={isBlobConfigured()}
    />
  );
}
