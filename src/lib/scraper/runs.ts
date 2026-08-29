import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { syncRuns, type SyncRun } from "@/lib/db/schema";

import { ScraperError } from "./client";

export class SyncBusyError extends ScraperError {}

export type RunKind = "orders" | "catalog";

const now = () => new Date().toISOString();

/**
 * A running row whose last heartbeat is older than this is treated as
 * crashed. Heartbeats are bumped on every probe/order, so a live run —
 * even a 30-minute catalog sweep — never goes stale.
 */
const STALE_RUN_MS = 10 * 60 * 1000;

/** Mutual exclusion across BOTH kinds — one polite scraper session at a time. */
export async function assertNoActiveRun(): Promise<void> {
  const running = await db
    .select()
    .from(syncRuns)
    .where(eq(syncRuns.status, "running"))
    .all();
  for (const run of running) {
    const last = run.heartbeatAt ?? run.startedAt;
    const age = Date.now() - new Date(last).getTime();
    if (Number.isFinite(age) && age < STALE_RUN_MS) {
      throw new SyncBusyError("同期が既に実行中です");
    }
    // Crashed run — close it out so it stops blocking.
    await db
      .update(syncRuns)
      .set({
        status: "error",
        finishedAt: now(),
        errorMessage: "中断されました（タイムアウト）",
      })
      .where(eq(syncRuns.id, run.id))
      .run();
  }
}

export async function beginRun(kind: RunKind): Promise<SyncRun> {
  return await db
    .insert(syncRuns)
    .values({ kind, startedAt: now(), heartbeatAt: now(), status: "running" })
    .returning()
    .get();
}

/** One tiny WAL write per unit of progress (~1/s) — negligible. */
export async function heartbeat(runId: number, processed: number): Promise<void> {
  await db
    .update(syncRuns)
    .set({ heartbeatAt: now(), ordersProcessed: processed })
    .where(eq(syncRuns.id, runId))
    .run();
}

export async function setRunTotal(
  runId: number,
  total: number | null,
): Promise<void> {
  await db
    .update(syncRuns)
    .set({ totalOrders: total })
    .where(eq(syncRuns.id, runId))
    .run();
}

export async function completeRun(
  runId: number,
  patch: { total?: number | null; processed?: number },
): Promise<void> {
  await db
    .update(syncRuns)
    .set({
      status: "success",
      finishedAt: now(),
      ...(patch.total !== undefined ? { totalOrders: patch.total } : {}),
      ...(patch.processed !== undefined ? { ordersProcessed: patch.processed } : {}),
    })
    .where(eq(syncRuns.id, runId))
    .run();
}

/** Mark every running row failed — used by the CLI's SIGINT handler. */
export async function failActiveRuns(message: string): Promise<void> {
  await db
    .update(syncRuns)
    .set({ status: "error", finishedAt: now(), errorMessage: message })
    .where(eq(syncRuns.status, "running"))
    .run();
}

export async function failRun(runId: number, message: string): Promise<void> {
  await db
    .update(syncRuns)
    .set({ status: "error", finishedAt: now(), errorMessage: message })
    .where(eq(syncRuns.id, runId))
    .run();
}
