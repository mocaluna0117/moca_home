import { CareSection } from "@/components/care/care-section";
import { HeartwormSection } from "@/components/care/heartworm-section";
import { MedicineSection } from "@/components/care/medicine-section";
import { SegmentedNav } from "@/components/segmented-nav";
import { todayJst, type CareKind, type DateStr } from "@/lib/calendar";
import { nowJstIso } from "@/lib/format";
import { isMailConfigured } from "@/lib/mail";
import {
  getCareCourses,
  getCarePlaces,
  getCareVisits,
  getCareYearTotals,
  getHeartwormDoses,
  getHeartwormMedicines,
  getMedicines,
} from "@/lib/queries-care";

export const dynamic = "force-dynamic";

type Tab = "trimming" | "hospital" | "heartworm" | "medicine";

/**
 * ケア記録。カレンダーとは別のトップレベルにしてある。
 * カレンダーは「その日に何をしたか」の日次ログ、ここは
 * 「いくら使ったか・次はいつか」の管理で、答える問いが違う。
 */
export default async function CarePage({ searchParams }: PageProps<"/care">) {
  const params = await searchParams;
  const raw = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const tab: Tab =
    raw === "hospital" || raw === "heartworm" || raw === "medicine"
      ? raw
      : "trimming";

  const today = todayJst(nowJstIso());

  const tabs = [
    { value: "trimming", label: "トリミング", href: "/care" },
    { value: "hospital", label: "通院", href: "/care?tab=hospital" },
    { value: "heartworm", label: "フィラリア", href: "/care?tab=heartworm" },
    { value: "medicine", label: "薬", href: "/care?tab=medicine" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <SegmentedNav items={tabs} current={tab} />

      {tab === "medicine" ? (
        <MedicineSection medicines={await getMedicines()} />
      ) : tab === "heartworm" ? (
        <HeartwormSection
          doses={await getHeartwormDoses()}
          today={today}
          mailConfigured={isMailConfigured()}
          medicines={await getHeartwormMedicines()}
        />
      ) : (
        <CareTab kind={tab} today={today} />
      )}
    </div>
  );
}

/**
 * トリミング／通院のタブ。記録と、その記録で選ぶ登録（お店・コース）を
 * 1往復で引く。コースの登録画面が出るのはトリミングだけ
 * （care_courses は kind を持つが、通院ぶんの画面はまだ無い）。
 */
async function CareTab({ kind, today }: { kind: CareKind; today: DateStr }) {
  const [visits, yearTotals, places, courses] = await Promise.all([
    getCareVisits(kind),
    getCareYearTotals(kind, today),
    getCarePlaces(kind),
    kind === "trimming" ? getCareCourses(kind) : Promise.resolve([]),
  ]);
  return (
    <CareSection
      kind={kind}
      visits={visits}
      yearTotals={yearTotals}
      today={today}
      places={places}
      courses={courses}
    />
  );
}
