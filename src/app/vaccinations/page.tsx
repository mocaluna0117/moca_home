import { VaccinationSection } from "@/components/calendar/vaccination-section";
import { aiProvider } from "@/lib/ai";
import { isBlobConfigured } from "@/lib/blob";
import { todayJst } from "@/lib/calendar";
import { nowJstIso } from "@/lib/format";
import { getVaccinations } from "@/lib/queries-log";

export const dynamic = "force-dynamic";

/**
 * 接種記録。カレンダーのタブから独立したページに移した
 * （証明書の写真と次回予定日の管理で、月グリッドとは見る目的が違う）。
 */
export default async function VaccinationsPage() {
  return (
    <VaccinationSection
      records={await getVaccinations()}
      blobEnabled={isBlobConfigured()}
      aiProvider={aiProvider()}
      today={todayJst(nowJstIso())}
    />
  );
}
