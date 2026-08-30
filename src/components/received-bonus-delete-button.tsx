"use client";

import { Trash2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { deleteReceivedBonus } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { callAction } from "@/lib/call-action";

/** No confirm step — personal tool; re-adding via the dialog is cheap. */
export function ReceivedBonusDeleteButton({
  id,
  orderId,
}: {
  id: number;
  orderId: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="この記録を削除"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const res = await callAction(() => deleteReceivedBonus(id, orderId));
          if (res.ok) toast.success("削除しました");
          else toast.error("削除に失敗しました", { description: res.error });
        })
      }
    >
      <Trash2 />
    </Button>
  );
}
