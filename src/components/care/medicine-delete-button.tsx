"use client";

import { Trash2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { deleteMedicine } from "@/lib/actions-care";
import { callAction } from "@/lib/call-action";

/** 薬を消しても記録は消えない（名前の写しが残る）。 */
export function MedicineDeleteButton({
  id,
  name,
  usedCount,
}: {
  id: number;
  name: string;
  usedCount: number;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`${name}を削除`}
      title={
        usedCount > 0
          ? `${usedCount}件の記録で使われています（記録は残ります）`
          : "この薬を削除"
      }
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const res = await callAction(() => deleteMedicine(id));
          if (res.ok) {
            toast.success("削除しました", {
              description:
                usedCount > 0
                  ? `${usedCount}件の記録には薬の名前が残ります。`
                  : undefined,
            });
          } else {
            toast.error("削除に失敗しました", { description: res.error });
          }
        })
      }
    >
      <Trash2 />
    </Button>
  );
}
