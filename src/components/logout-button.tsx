"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { logout } from "@/app/login/actions";

export function LogoutButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label="ログアウト"
      title="ログアウト"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await logout();
          router.replace("/login");
        })
      }
    >
      <LogOut />
    </Button>
  );
}
