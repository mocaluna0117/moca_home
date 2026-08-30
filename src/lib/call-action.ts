/**
 * Server Action の呼び出しを包む。
 *
 * middleware はセッション切れの POST に 401 を返す（HTMLリダイレクトにすると
 * Server Action が壊れるため）。クライアント側では、その 401 は action 呼び出しの
 * **例外**として現れる。startTransition の中で捕まえないと React のエラー境界まで
 * 飛び、ダイアログごと画面が落ちて入力中の内容が消える。
 *
 * 30日のcookieが切れる・別タブでログアウトする・圏外になる、で普通に起きる。
 * 呼び出し側は今までどおり `{ ok, error }` だけを見ればよい。
 */
export async function callAction<T extends { ok: boolean }>(
  run: () => Promise<T>,
): Promise<T | { ok: false; error: string }> {
  try {
    return await run();
  } catch {
    return {
      ok: false,
      error: "通信に失敗しました。ログインし直すか、もう一度お試しください。",
    };
  }
}
