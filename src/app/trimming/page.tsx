import { CareSection } from "@/components/care/care-section";
import { todayJst } from "@/lib/calendar";
import { nowJstIso } from "@/lib/format";
import {
  getCareCourses,
  getCarePlaces,
  getCareVisits,
  getCareYearTotals,
} from "@/lib/queries-care";

export const dynamic = "force-dynamic";

/**
 * トリミング。予約と記録が同じ1つの一覧に並ぶ（今日より先の日付が予約）。
 *
 * 通院と同じ CareSection を kind 違いで描くだけだが、ページは分けてある —
 * ヘッダーのタブから直接開ける場所が「トリミング」「通院」の2つに割れており、
 * ?tab= を1本のページで捌くと、どちらのページに居るのかを URL と
 * コンポーネントの両方が別々に決めることになる。
 *
 * 記録で選ぶ登録（お店・コース）も一緒に引く。コースの登録画面が出るのは
 * トリミングだけ（care_courses は kind を持つが、通院ぶんの画面はまだ無い）。
 */
export default async function TrimmingPage() {
  const today = todayJst(nowJstIso());
  const [visits, yearTotals, places, courses] = await Promise.all([
    getCareVisits("trimming", today),
    getCareYearTotals("trimming", today),
    getCarePlaces("trimming"),
    getCareCourses("trimming"),
  ]);

  return (
    <CareSection
      kind="trimming"
      visits={visits}
      yearTotals={yearTotals}
      today={today}
      places={places}
      courses={courses}
    />
  );
}
