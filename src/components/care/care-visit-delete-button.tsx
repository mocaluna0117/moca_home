"use client";

import { Trash2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { deleteCareVisit } from "@/lib/actions-care";
import { callAction } from "@/lib/call-action";

/** 明細は onDelete: cascade で一緒に消える。 */
export function CareVisitDeleteButton({ id }: { id: number }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="この記録を削除"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const res = await callAction(() => deleteCareVisit(id));
          if (res.ok) toast.success("削除しました");
          else toast.error("削除に失敗しました", { description: res.error });
        })
      }
    >
      <Trash2 />
    </Button>
  );
}
