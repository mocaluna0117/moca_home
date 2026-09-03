import { Scissors, Stethoscope, Store } from "lucide-react";

import { CareCourseDialog } from "@/components/care/care-course-dialog";
import { CarePlaceDialog } from "@/components/care/care-place-dialog";
import type { CareKind } from "@/lib/calendar";
import type { CareCourseRow, CarePlaceRow } from "@/lib/queries-care";

/**
 * 記録のダイアログで選ぶ「登録」の一覧（RSC）: いつも行くお店・病院と、
 * トリミングのコース。
 *
 * 別タブにせず、その記録のタブの中（記録の一覧の上）に置く。登録は
 * 高々数件のチップで済み、記録するときに「候補が無い」と気づいたその場で
 * 足せるため。薬が別タブなのは、フィラリアと通院の2つの記録から参照される
 * 共有の登録だから — お店とコースは種類ごとの登録で、共有する相手が無い。
 *
 * チップを押すと編集（削除もその中）。行ごとの削除ボタンを並べないのは、
 * 1行に収めるため。
 */
export function CareMasters({
  kind,
  places,
  courses,
}: {
  kind: CareKind;
  places: CarePlaceRow[];
  /** 通院では常に空（コースの登録画面が出るのはトリミングだけ） */
  courses: CareCourseRow[];
}) {
  const placeNoun = kind === "trimming" ? "お店" : "病院";
  const PlaceIcon = kind === "trimming" ? Store : Stethoscope;

  return (
    <section aria-label={`${placeNoun}とコースの登録`} className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <h3 className="mr-1 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <PlaceIcon className="size-3.5" aria-hidden="true" />
          いつも行く{placeNoun}
        </h3>
        {places.map((p) => (
          <CarePlaceDialog key={p.id} kind={kind} place={p} />
        ))}
        <CarePlaceDialog kind={kind} />
        {places.length === 0 && (
          <span className="text-xs text-muted-foreground">
            登録すると、記録するときに選べます。
          </span>
        )}
      </div>

      {kind === "trimming" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 className="mr-1 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Scissors className="size-3.5" aria-hidden="true" />
            コース
          </h3>
          {courses.map((c) => (
            <CareCourseDialog key={c.id} kind={kind} course={c} />
          ))}
          <CareCourseDialog kind={kind} />
          {courses.length === 0 && (
            <span className="text-xs text-muted-foreground">
              金額と一緒に登録すると、明細に1タップで入ります。
            </span>
          )}
        </div>
      )}
    </section>
  );
}
