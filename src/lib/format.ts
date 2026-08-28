const yenFormatter = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

export const formatYen = (yen: number | null | undefined) =>
  yen === null || yen === undefined ? "—" : yenFormatter.format(yen);

/** "2026-08-22T08:50:31+09:00" -> "2026/08/22" */
export const formatDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : iso;
};

/** "2026-08-22T08:50:31+09:00" -> "2026/08/22 08:50" */
export const formatDateTime = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? `${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5]}` : iso;
};

/** Relative-ish label for the "最終同期" header slot. */
export const formatSyncedAt = (iso: string | null | undefined) => {
  if (!iso) return "未同期";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "未同期";
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return "たった今";
  if (mins < 60) return `${mins}分前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}時間前`;
  return `${Math.floor(hours / 24)}日前`;
};

/**
 * "Now" as an ISO-8601 string with an explicit +09:00 offset, matching the
 * convention every date column in this schema uses. `toISOString()` alone
 * yields UTC, which renders as the previous day for anything recorded after
 * 09:00 JST.
 */
export const nowJstIso = (): string =>
  new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "+09:00");

export const parseJsonArray = (raw: string | null | undefined): string[] => {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};
