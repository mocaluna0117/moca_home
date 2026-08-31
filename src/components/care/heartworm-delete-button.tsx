"use client";

import { Trash2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { deleteHeartwormDose } from "@/lib/actions-care";
import { callAction } from "@/lib/call-action";
import { formatDate } from "@/lib/format";

/**
 * 一覧の各行から予定を消す。
 *
 * 確認を挟まないのは、既存の記録の削除ボタン（接種記録・来店記録）と
 * 揃えるため。予定は作り直せるので、押し間違いの代償が小さい。
 * ただし投薬済みの行は実績が消えるので、ラベルで区別する。
 */
export function HeartwormDeleteButton({
  id,
  scheduledDate,
  given,
}: {
  id: number;
  scheduledDate: string;
  given: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`${formatDate(scheduledDate)}の${given ? "投薬記録" : "予定"}を削除`}
      title={given ? "投薬記録ごと削除" : "予定を削除"}
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const res = await callAction(() => deleteHeartwormDose(id));
          if (res.ok) toast.success("削除しました");
          else toast.error("削除に失敗しました", { description: res.error });
        })
      }
    >
      <Trash2 />
    </Button>
  );
}
