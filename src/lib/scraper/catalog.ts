import "server-only";

import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";

import { HttpClient, NotFoundError, ScraperError, loadConfig } from "./client";
import { login } from "./login";
import { fetchProduct } from "./products";
import { assertNoActiveRun, beginRun, completeRun, failRun, heartbeat } from "./runs";

export type CatalogProgress =
  | { phase: "login" }
  | {
      phase: "catalog";
      probed: number;
      estimatedTotal: number;
      currentId: number;
      found: number;
      notFound: number;
      errors: number;
    }
  | { phase: "done"; summary: CatalogSummary };

export interface CatalogSummary {
  probed: number;
  productsOk: number;
  productsNotFound: number;
  productsError: number;
  maxLiveId: number | null;
  stoppedAtId: number;
}

/**
 * Consecutive 404s above the highest live id before the frontier walk stops.
 * The shop's id space has real interior holes (observed: live 1200 → dead
 * 1250–1350 → live 1387/1400 ≈ up to ~186 consecutive dead ids), so 100 would
 * stop inside a hole; 250 = widest observed hole + ~35% margin. The counter
 * only governs the region ABOVE the last known live id — interior holes are
 * bridged for free because a higher live id is already known.
 */
const FRONTIER_STOP = 250;

/** Hard cap on how far past the last live id a single run may walk. */
const FRONTIER_MAX_SPAN = 2000;

/** Consecutive transport/5xx errors before aborting (site down). */
const MAX_CONSECUTIVE_ERRORS = 5;

const now = () => new Date().toISOString();

/**
 * Catalog acquisition by ID sweep. The shop hides its catalog from every
 * list/search page, but /products/detail/{id} stays reachable for every
 * non-deleted product — including sold-out, unlisted ones.
 *
 * - Interior pass: probe ids in [1, lastLiveId] missing from `products`.
 *   404s are stubbed `not_found` (EC-CUBE never reuses ids → permanently
 *   skippable). `pending`/`error` rows are skipped — runSync owns retrying.
 * - Frontier pass: walk upward from lastLiveId+1. 404s are buffered and only
 *   persisted once a HIGHER live id proves them interior; the trailing buffer
 *   is DISCARDED — a trailing 404 can come alive next week (next
 *   auto-increment id), so stubbing it would create a permanent blind spot.
 *   Re-probing the same ~250-id tail next run costs the same requests a
 *   fresh frontier would.
 */
export async function runCatalogSync(
  onProgress?: (p: CatalogProgress) => void,
): Promise<CatalogSummary> {
  const config = loadConfig();
  assertNoActiveRun();
  const run = beginRun("catalog");

  const summary: CatalogSummary = {
    probed: 0,
    productsOk: 0,
    productsNotFound: 0,
    productsError: 0,
    maxLiveId: null,
    stoppedAtId: 0,
  };

  try {
    const client = new HttpClient(config);
    onProgress?.({ phase: "login" });
    await login(client, config);

    const known = new Map<number, string>(
      db
        .select({ id: products.id, fetchStatus: products.fetchStatus })
        .from(products)
        .all()
        .map((r) => [r.id, r.fetchStatus]),
    );
    let lastLiveId = 0;
    for (const [id, status] of known) {
      if (status === "ok" && id > lastLiveId) lastLiveId = id;
    }
    summary.maxLiveId = lastLiveId || null;

    const interiorTargets: number[] = [];
    for (let id = 1; id <= lastLiveId; id++) {
      if (!known.has(id)) interiorTargets.push(id);
    }
    let estimatedTotal = interiorTargets.length + FRONTIER_STOP;

    let consecutiveErrors = 0;

    const emit = (currentId: number) => {
      heartbeat(run.id, summary.probed);
      onProgress?.({
        phase: "catalog",
        probed: summary.probed,
        estimatedTotal,
        currentId,
        found: summary.productsOk,
        notFound: summary.productsNotFound,
        errors: summary.productsError,
      });
    };

    const insertOk = async (id: number) => {
      const parsed = await fetchProduct(client, id);
      db.insert(products)
        .values({
          id,
          name: parsed.name,
          priceYen: parsed.priceYen,
          descriptionHtml: parsed.descriptionHtml,
          category: parsed.category,
          tags: JSON.stringify(parsed.tags),
          imageUrls: JSON.stringify(parsed.imageUrls),
          fetchStatus: "ok",
          fetchedAt: now(),
          updatedAt: now(),
        })
        .onConflictDoNothing()
        .run();
    };

    const insertNotFound = (id: number) => {
      db.insert(products)
        .values({ id, fetchStatus: "not_found", fetchedAt: now(), updatedAt: now() })
        .onConflictDoNothing()
        .run();
    };

    /** Probe one id. Returns "ok" | "not_found" | "error". */
    const probe = async (id: number): Promise<"ok" | "not_found" | "error"> => {
      summary.probed++;
      try {
        await insertOk(id);
        summary.productsOk++;
        consecutiveErrors = 0;
        return "ok";
      } catch (err) {
        if (err instanceof NotFoundError) {
          summary.productsNotFound++;
          consecutiveErrors = 0;
          return "not_found";
        }
        summary.productsError++;
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          throw new ScraperError(
            `連続エラーが${MAX_CONSECUTIVE_ERRORS}回に達したため中断しました`,
          );
        }
        // Recorded as error so the next catalog run retries it.
        db.insert(products)
          .values({ id, fetchStatus: "error", fetchedAt: now(), updatedAt: now() })
          .onConflictDoNothing()
          .run();
        return "error";
      }
    };

    // --- interior pass -----------------------------------------------------
    for (const id of interiorTargets) {
      const result = await probe(id);
      if (result === "not_found") insertNotFound(id);
      summary.stoppedAtId = id;
      emit(id);
    }

    // --- frontier pass -----------------------------------------------------
    let consecutive404 = 0;
    let pending404: number[] = [];
    for (
      let id = lastLiveId + 1;
      consecutive404 < FRONTIER_STOP && id <= lastLiveId + FRONTIER_MAX_SPAN;
      id++
    ) {
      summary.stoppedAtId = id;
      const knownStatus = known.get(id);
      if (knownStatus === "ok") {
        consecutive404 = 0;
        continue;
      }
      if (knownStatus === "not_found") {
        // Legacy/crash leftover — counts toward the stop without a request.
        consecutive404++;
        continue;
      }
      if (knownStatus !== undefined) continue; // pending/error → runSync's job

      const result = await probe(id);
      if (result === "ok") {
        // A higher live id proves the buffered 404s interior — persist them.
        for (const dead of pending404) insertNotFound(dead);
        pending404 = [];
        consecutive404 = 0;
        summary.maxLiveId = id;
        estimatedTotal = summary.probed + FRONTIER_STOP;
      } else if (result === "not_found") {
        pending404.push(id);
        consecutive404++;
      }
      // "error": row already recorded; counter untouched.
      emit(id);
    }
    // Trailing buffer deliberately discarded (see doc comment above).

    completeRun(run.id, { total: summary.probed, processed: summary.probed });
    onProgress?.({ phase: "done", summary });
    return summary;
  } catch (err) {
    failRun(run.id, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
