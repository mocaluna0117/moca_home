import { Pill } from "lucide-react";

import { MedicineDeleteButton } from "@/components/care/medicine-delete-button";
import { MedicineDialog } from "@/components/care/medicine-dialog";
import { Badge } from "@/components/ui/badge";
import type { MedicineRow } from "@/lib/queries-care";

/** 薬の一覧（RSC）。 */
export function MedicineSection({ medicines }: { medicines: MedicineRow[] }) {
  const heartworm = medicines.filter((m) => m.forHeartworm).length;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-medium">
          <Pill className="size-4" aria-hidden="true" />
          薬
        </h2>
        {medicines.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {medicines.length}件（うちフィラリア用 {heartworm}件）
          </span>
        )}
        <div className="ml-auto">
          <MedicineDialog triggerVariant="default" />
        </div>
      </div>

      {medicines.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">まだ薬が登録されていません</p>
          <p className="mt-1 text-xs text-muted-foreground">
            登録すると、記録するときに名前を打たずに選べます。
            「フィラリア予防薬」に入れたものだけがフィラリアの候補に出ます。
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {medicines.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-3"
            >
              <span className="break-words">{m.name}</span>
              {m.forHeartworm && (
                <Badge variant="secondary" className="font-normal">
                  フィラリア用
                </Badge>
              )}
              {m.usedCount > 0 && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {m.usedCount}件の記録で使用
                </span>
              )}
              <div className="ml-auto flex items-center gap-1">
                <MedicineDialog
                  medicine={{ id: m.id, name: m.name, forHeartworm: m.forHeartworm }}
                  triggerVariant="ghost"
                />
                <MedicineDeleteButton id={m.id} name={m.name} usedCount={m.usedCount} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        薬を削除しても、過去の記録から名前が消えることはありません。
      </p>
    </section>
  );
}
