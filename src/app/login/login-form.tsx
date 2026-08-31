"use client";

import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { login } from "./actions";

export function LoginForm({ from }: { from: string }) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(login, undefined);

  useEffect(() => {
    if (state?.ok) router.replace(from);
  }, [state?.ok, from, router]);

  return (
    <form
      action={formAction}
      className="flex w-full max-w-sm flex-col gap-4 rounded-xl border p-6"
    >
      <div className="flex items-center gap-2">
        <Lock className="size-4 text-muted-foreground" aria-hidden="true" />
        <h1 className="font-cute text-xl">もかのほーむ</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        閲覧するにはパスワードを入力してください。
      </p>
      <Input
        type="password"
        name="password"
        placeholder="パスワード"
        aria-label="パスワード"
        autoComplete="current-password"
        autoFocus
        required
      />
      {state?.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
      <Button type="submit" disabled={isPending}>
        {isPending ? "確認中…" : "ログイン"}
      </Button>
    </form>
  );
}
