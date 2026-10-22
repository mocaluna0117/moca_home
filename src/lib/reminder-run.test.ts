import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { RemindError } from "./mail-config";
import {
  reminderMark,
  runReminder,
  type ReminderDeps,
  type ReminderStore,
  type SendResult,
} from "./reminder-run";

/** heartworm_doses の1行のうち、リマインドが触る列だけ */
interface Row {
  id: number;
  scheduledDate: string;
  givenDate: string | null;
  label: string | null;
  remindedAt: string | null;
  remindError: RemindError | null;
}

/** 時刻は止めておく。2本の実行が同じ秒に始まった状態 */
const NOW = "2026-08-31T08:00:00+09:00";
const TODAY = "2026-08-31";

const row = (id: number, scheduledDate: string): Row => ({
  id,
  scheduledDate,
  givenDate: null,
  label: null,
  remindedAt: null,
  remindError: null,
});

/**
 * メモリ上の heartworm_doses。src/lib/reminder.ts の SQL と同じ条件で動く
 * （予約は reminded_at IS NULL の行だけ、それ以降は reminded_at = mark の行だけ）。
 *
 * afterRead を渡すと、候補を読んだ直後にそこで待つ。2本がどちらも
 * 予約より前に候補を読み終えた状態（本番で同時に走ったとき）を作るため。
 */
function memoryStore(rows: Row[], afterRead?: () => Promise<void>): ReminderStore {
  return {
    async candidates() {
      // 読んだ時点の写しを返す。待つのは写しを取ったあと
      const snapshot = rows.map(({ id, scheduledDate, givenDate, remindedAt }) => ({
        id,
        scheduledDate,
        givenDate,
        remindedAt,
      }));
      await afterRead?.();
      return snapshot;
    },
    async reserve(ids, mark) {
      for (const r of rows) {
        if (ids.includes(r.id) && r.remindedAt === null) r.remindedAt = mark;
      }
    },
    async reserved(mark) {
      return rows
        .filter((r) => r.remindedAt === mark)
        .map(({ id, scheduledDate, label }) => ({ id, scheduledDate, label }));
    },
    async release(mark, reason) {
      for (const r of rows) {
        if (r.remindedAt !== mark) continue;
        r.remindedAt = null;
        r.remindError = reason;
      }
    },
    async markSent(mark) {
      for (const r of rows) {
        if (r.remindedAt === mark) r.remindError = null;
      }
    },
  };
}

/** parties 本がそろうまで、全員をそこで待たせる */
function barrier(parties: number): () => Promise<void> {
  let arrived = 0;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  return () => {
    arrived += 1;
    if (arrived === parties) open();
    return gate;
  };
}

/** 送ろうとしたメールを溜める。返す結果は固定 */
function mailbox(result: SendResult = { ok: true }) {
  const sent: { subject: string; text: string }[] = [];
  const send: ReminderDeps["send"] = async (mail) => {
    sent.push(mail);
    return result;
  };
  return { sent, send };
}

const deps = (store: ReminderStore, send: ReminderDeps["send"]): ReminderDeps => ({
  store,
  now: () => NOW,
  mailConfigured: true,
  send,
  sleep: async () => {},
});

describe("reminderMark — 実行ごとに違う印", () => {
  it("同じ時刻から作っても、2回目は別の値になる", () => {
    assert.notEqual(reminderMark(NOW), reminderMark(NOW));
  });

  it("先頭は時刻のまま（reminded_at を日付として読んでも壊れない）", () => {
    assert.ok(reminderMark(NOW).startsWith(NOW));
    assert.ok(reminderMark(NOW).length > NOW.length);
  });
});

describe("runReminder — 二重に走っても1通だけ", () => {
  it("同じ秒に始まった2本が同じ予定を取り合っても、送るのは1本だけ", async () => {
    const rows = [row(1, "2026-08-30"), row(2, TODAY)];
    // 2本とも、どちらかが予約するより前に候補を読み終える
    const store = memoryStore(rows, barrier(2));
    const box = mailbox();

    const results = await Promise.all([
      runReminder(deps(store, box.send)),
      runReminder(deps(store, box.send)),
    ]);

    assert.equal(box.sent.length, 1);
    assert.deepEqual(
      results.map((r) => r.due),
      [2, 2],
    );
    assert.deepEqual(results.map((r) => r.sent).sort(), [0, 2]);
    // 2行とも、送った1本の印が付いている
    assert.ok(rows[0].remindedAt?.startsWith(NOW));
    assert.equal(rows[1].remindedAt, rows[0].remindedAt);
  });

  it("失敗した実行が戻すのは、自分が予約した行だけ", async () => {
    const rows = [row(1, TODAY)];
    const store = memoryStore(rows);

    // 1本目は送れた
    const first = await runReminder(deps(store, mailbox().send));
    assert.equal(first.sent, 1);
    const firstMark = rows[0].remindedAt;
    assert.notEqual(firstMark, null);

    // 同じ秒のうちに予定が1件増え、2本目が走って送信に失敗する
    rows.push(row(2, "2026-08-30"));
    const failing = mailbox({ ok: false, reason: "auth" });
    const second = await runReminder(deps(store, failing.send));
    assert.deepEqual(second, { today: TODAY, due: 1, sent: 0, reason: "auth" });

    // 1本目の予約はそのまま。戻って理由が残るのは増えた1件だけ
    assert.equal(rows[0].remindedAt, firstMark);
    assert.equal(rows[0].remindError, null);
    assert.equal(rows[1].remindedAt, null);
    assert.equal(rows[1].remindError, "auth");
    // 2本目が送ろうとしたのも増えた1件だけ。1本目が送った予定を混ぜない
    assert.equal(failing.sent.length, 1);
    assert.equal(failing.sent[0].subject, "【フィラリア】2026年8月30日の投薬がまだです");
  });
});
