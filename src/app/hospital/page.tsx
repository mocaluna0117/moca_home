import { CareSection } from "@/components/care/care-section";
import { todayJst } from "@/lib/calendar";
import { nowJstIso } from "@/lib/format";
import {
  getCarePlaces,
  getCareVisits,
  getCareYearTotals,
} from "@/lib/queries-care";

export const dynamic = "force-dynamic";

/**
 * 通院。トリミングと同じ CareSection を kind="hospital" で描く。
 *
 * コースは引かない（登録の画面を出すのはトリミングだけ）。空配列を渡すと
 * CareSection が「コースから追加」の段そのものを出さない。
 */
export default async function HospitalPage() {
  const today = todayJst(nowJstIso());
  const [visits, yearTotals, places] = await Promise.all([
    getCareVisits("hospital", today),
    getCareYearTotals("hospital", today),
    getCarePlaces("hospital"),
  ]);

  return (
    <CareSection
      kind="hospital"
      visits={visits}
      yearTotals={yearTotals}
      today={today}
      places={places}
      courses={[]}
    />
  );
}
