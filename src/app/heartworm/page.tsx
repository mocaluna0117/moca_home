import { HeartwormSection } from "@/components/care/heartworm-section";
import { todayJst } from "@/lib/calendar";
import { nowJstIso } from "@/lib/format";
import { isMailConfigured } from "@/lib/mail";
import { getHeartwormDoses, getHeartwormMedicines } from "@/lib/queries-care";

export const dynamic = "force-dynamic";

/** フィラリアの予定と実績。 */
export default async function HeartwormPage() {
  const today = todayJst(nowJstIso());
  const [doses, medicines] = await Promise.all([
    getHeartwormDoses(),
    getHeartwormMedicines(),
  ]);

  return (
    <HeartwormSection
      doses={doses}
      today={today}
      mailConfigured={isMailConfigured()}
      medicines={medicines}
    />
  );
}
