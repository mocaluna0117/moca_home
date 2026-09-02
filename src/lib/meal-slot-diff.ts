/**
 * 記録ダイアログの保存で「消してよい行」だけを選ぶ差分計算。
 * DB も React も import しない純モジュール（tsx --test で単体実行できる）。
 *
 * `saveMealSlot` はもともと「ペイロードに無い既存行は消す」だった。ダイアログは
 * 3スロットを毎回まとめて保存するので、飼い主が触っていないスロットでも
 * 「ペイロードが空」＝「そのスロットを全部消す」になる。いつものご飯の自動記録が
 * 入ると、これが毎日踏める穴になる:
 *
 *   07:59 飼い主がダイアログを開く（朝ごはんは0品）
 *   08:00 cron が朝ごはんを2品入れる
 *   08:01 飼い主が夜だけ入れて保存 → 朝のペイロードは空 →
 *         入ったばかりの2行が黙って消える
 *
 * そこで削除対象を「ダイアログが開いた時点で見えていた行」に狭める。飼い主が
 * 見たことのない行は、消す意思を示された行ではないので触らない。エラーで
 * 拒否せず黙って放置するのは、UI に新しい失敗経路を増やさないため（知らない行は
 * 次に開き直したときには見えているので、消したければそこで消せる）。
 *
 * **これは同時実行の安全弁であって、権限の境界ではない。** `knownIds` は
 * クライアントから来るので任意の id を名乗れる。それでも困らないのは、交差を
 * 取る相手が呼び出し側の読んだ「その (date,slot) の既存 id」に限られ、他の日付や
 * 他のスロットには届かないから。誰が叩けるかはセッションゲートの仕事。
 */

/**
 * 削除する = 既存id ∩ 見えていたid − 更新したid
 *
 * 順序は `existingIds` の順（DELETE を撃つ順が入力で決まるので、テストで並びを
 * 固定できる）。同じ id は何度渡されても1度しか返さない。
 *
 * `knownIds` が空なら結果も空 = 何も消さない。ダイアログの id が欠けて届いた日に
 * 全消しではなく無害な側へ倒れる（消し忘れは開き直せば直せるが、消えた記録は
 * 戻らない）。
 */
export function deletableIds(input: {
  /** いま DB にある (date,slot) の id */
  existingIds: readonly number[];
  /** ダイアログを開いた時点で見えていた id */
  knownIds: readonly number[];
  /** 今回のペイロードで更新した id */
  keptIds: readonly number[];
}): number[] {
  const known = new Set(input.knownIds);
  const kept = new Set(input.keptIds);
  const ids: number[] = [];
  for (const id of input.existingIds) {
    if (kept.has(id)) continue;
    // delete が true を返すのは初回だけ。existingIds に同じ id が
    // 2回入っていても DELETE を2回撃たない
    if (!known.delete(id)) continue;
    ids.push(id);
  }
  return ids;
}
