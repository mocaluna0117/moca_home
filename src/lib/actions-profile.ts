"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { actionError } from "@/lib/action-error";
import { PHOTO_RULES, deleteBlobs, isBlobUrl, parseBlobPath } from "@/lib/blob";
import { isDateOnly, todayJst } from "@/lib/calendar";
import { db } from "@/lib/db";
import { dogProfile } from "@/lib/db/schema";
import { nowJstIso } from "@/lib/format";
import {
  MAX_BREED_LENGTH,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_WEIGHT_G,
  MIN_WEIGHT_G,
  PROFILE_ROW_ID,
  isDogSex,
  parseWeightKg,
  type DogSex,
} from "@/lib/profile";

/**
 * もかのプロフィール（dog_profile）への書き込み。
 *
 * 行は常に高々1行なので、書き込みは id 固定の upsert 1本だけ。
 * **どの行を書くかを引数で受けない** — id をクライアントから受ければ
 * 「表示される行はどれか」という第2の真実が生まれる。
 *
 * revalidate は "/" だけ。プロフィールはホームのヒーローにしか出ないので、
 * /calendar や /care を無効化する理由が無い。
 *
 * 写真の実体は Vercel Blob（private ストア）で、ここが持つのはメタデータだけ。
 * アップロードはブラウザ → Blob の直行でサーバがバイト列を一度も見ないので、
 * クライアントが渡すメタデータの検証はこのファイルが唯一の関門になる
 * （actions-log.ts の attachVaccinationPhoto と同じ立場）。
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

const now = nowJstIso;

/** 行が無いのは「まだ作っていない」状態。写真だけ先に付けることはできない */
const ROW_MISSING = "プロフィールがまだありません";

function revalidateProfile(): void {
  revalidatePath("/");
}

/** 空白だけの入力は「入っていない」と同じに扱う（"　" を犬種として保存しない） */
const trimTo = (raw: string | null | undefined): string | null =>
  raw?.trim() ? raw.trim() : null;

// ------------------------------------------------------------ 文字の項目

export interface DogProfileInput {
  name: string;
  breed: string | null;
  sex: DogSex | null;
  /** DATE ONLY 'YYYY-MM-DD' */
  birthday: string | null;
  /** DATE ONLY 'YYYY-MM-DD' */
  cameHomeOn: string | null;
  /** 「5.2」「５．２」「5.2kg」などの生入力。kg → グラムの変換は parseWeightKg だけが持つ */
  weightKg: string | null;
  /** DATE ONLY 'YYYY-MM-DD' */
  weighedOn: string | null;
  note: string | null;
}

/**
 * プロフィールの保存。行が無ければ作り、あれば上書きする（upsert 1経路）。
 *
 * 長さの上限は src/lib/profile.ts の定数から文章を組む。ダイアログの
 * maxLength と同じ数字が2箇所に散らないようにするため。
 */
export async function saveDogProfile(input: DogProfileInput): Promise<ActionResult> {
  try {
    // 「今日」はサーバで決める。未来日の判定を端末の時計に任せると、
    // ずれた時計の端末だけが通る／通らない行ができる
    const today = todayJst(now());

    const name = trimTo(input.name);
    if (name === null) return { ok: false, error: "なまえを入力してください" };
    if (name.length > MAX_NAME_LENGTH) {
      return { ok: false, error: `なまえは${MAX_NAME_LENGTH}文字以内で入力してください` };
    }

    const breed = trimTo(input.breed);
    if (breed !== null && breed.length > MAX_BREED_LENGTH) {
      return { ok: false, error: `犬種は${MAX_BREED_LENGTH}文字以内で入力してください` };
    }

    const note = trimTo(input.note);
    if (note !== null && note.length > MAX_NOTE_LENGTH) {
      return { ok: false, error: `ひとことは${MAX_NOTE_LENGTH}文字以内で入力してください` };
    }

    // 列挙の外の文字列を素通しすると、SEX_LABEL に無いキーがヒーローに出る
    if (input.sex !== null && !isDogSex(input.sex)) {
      return { ok: false, error: "性別が不正です" };
    }
    const sex = input.sex;

    const birthday = trimTo(input.birthday);
    if (birthday !== null && !isDateOnly(birthday)) {
      return { ok: false, error: "たんじょうびの形式が正しくありません" };
    }
    if (birthday !== null && birthday > today) {
      return { ok: false, error: "たんじょうびは今日より後にできません" };
    }

    const cameHomeOn = trimTo(input.cameHomeOn);
    if (cameHomeOn !== null && !isDateOnly(cameHomeOn)) {
      return { ok: false, error: "おうちに来た日の形式が正しくありません" };
    }
    if (cameHomeOn !== null && cameHomeOn > today) {
      return { ok: false, error: "おうちに来た日は今日より後にできません" };
    }
    // 生まれる前に家に来ている行を作らせない。ageLabel / togetherDaysLabel は
    // どちらも「未来なら null」しか見ないので、この矛盾はすり抜けて表示される
    if (birthday !== null && cameHomeOn !== null && cameHomeOn < birthday) {
      return { ok: false, error: "おうちに来た日はたんじょうびより後にしてください" };
    }

    const weighedOn = trimTo(input.weighedOn);
    if (weighedOn !== null && !isDateOnly(weighedOn)) {
      return { ok: false, error: "体重をはかった日の形式が正しくありません" };
    }

    let weightGrams: number | null = null;
    if (trimTo(input.weightKg) !== null) {
      weightGrams = parseWeightKg(input.weightKg);
      if (weightGrams === null) {
        return {
          ok: false,
          error: `体重は ${MIN_WEIGHT_G / 1000}〜${MAX_WEIGHT_G / 1000}kg の範囲で入力してください`,
        };
      }
      if (weighedOn === null) {
        return { ok: false, error: "体重を入れるときは、はかった日も入れてください" };
      }
    }

    const fields = {
      name,
      breed,
      sex,
      birthday,
      cameHomeOn,
      weightGrams,
      // 体重が無い行に測定日だけ残さない（2列で1つの事実。片方だけでは何も言えない）
      weighedOn: weightGrams === null ? null : weighedOn,
      note,
    };

    await db
      .insert(dogProfile)
      .values({ id: PROFILE_ROW_ID, ...fields, createdAt: now(), updatedAt: now() })
      .onConflictDoUpdate({
        target: dogProfile.id,
        // 写真の4列は **set に入れない**。文字項目を保存しただけで写真が
        // 消えるのを防ぐ（写真は setDogPhoto / removeDogPhoto だけが触る）
        set: { ...fields, updatedAt: now() },
      })
      .run();

    revalidateProfile();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, "保存に失敗しました"),
    };
  }
}

// ---------------------------------------------------------------- 写真

export interface DogPhotoInput {
  /**
   * アップロード結果の URL。**列には保存しない**（private ストアの URL は
   * 誰も直接開けず、表示は /api/dog-photo・削除は pathname で足りる）。
   * 本物のアップロード由来であることの証明としてだけ検証する。
   */
  url: string;
  pathname: string;
  contentType: string | null;
  sizeBytes: number | null;
}

/**
 * 写真を差し替える。**行が先にあることが前提** — ダイアログは
 * saveDogProfile → upload → ここ の順で呼ぶので、キャンセルした時点では
 * まだ何も上がっておらず、孤児 blob が原理的に生まれない。
 *
 * 検証は url → 保存先（kind）→ 形式 → サイズ → 行の存在 の順。
 * pathname は接頭辞の許可リストで判定するので、証明書側（vaccinations/）の
 * パスはここに入って来られない（src/lib/blob.ts の parseBlobPath 参照）。
 * contentType / sizeBytes が null のときに落とさないのは、トークン発行側
 * （/api/blob/upload）が kind ごとの allowedContentTypes と
 * maximumSizeInBytes で既に実体を縛っているため。
 *
 * **旧 pathname を読んでから DB を更新し、コミット後に旧 blob を消す。**
 * 逆順にすると、行がまだ指している blob を消す瞬間ができる。そこで落ちると
 * 「写真がある行なのに 404」になり、画面からは直せない。
 */
export async function setDogPhoto(meta: DogPhotoInput): Promise<ActionResult> {
  try {
    if (!isBlobUrl(meta.url)) return { ok: false, error: "写真のURLが不正です" };
    if (parseBlobPath(meta.pathname)?.kind !== "profile") {
      return { ok: false, error: "写真の保存先が不正です" };
    }
    const rules = PHOTO_RULES.profile;
    if (meta.contentType && !rules.types.includes(meta.contentType)) {
      return { ok: false, error: "対応していない画像形式です" };
    }
    if (meta.sizeBytes !== null && (meta.sizeBytes < 1 || meta.sizeBytes > rules.maxBytes)) {
      return { ok: false, error: "画像サイズが大きすぎます" };
    }

    const existing = await db
      .select({ pathname: dogProfile.photoPathname })
      .from(dogProfile)
      .where(eq(dogProfile.id, PROFILE_ROW_ID))
      .get();
    if (!existing) return { ok: false, error: ROW_MISSING };

    await db
      .update(dogProfile)
      .set({
        photoPathname: meta.pathname,
        photoContentType: meta.contentType,
        photoSizeBytes: meta.sizeBytes,
        // ?v= のキャッシュ破りの種。差し替えたことがブラウザに伝わる唯一の値
        photoUpdatedAt: now(),
        updatedAt: now(),
      })
      .where(eq(dogProfile.id, PROFILE_ROW_ID))
      .run();

    // ここから best-effort（DB は既にコミット済み）。同じ pathname は消さない —
    // 再送で同じ実体を指したときに、いま上げた写真を落としてしまう
    if (existing.pathname && existing.pathname !== meta.pathname) {
      await deleteBlobs([existing.pathname]);
    }
    revalidateProfile();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, "写真の差し替えに失敗しました"),
    };
  }
}

/** 写真を消す。文字の項目は残す（写真4列だけを null に戻す）。 */
export async function removeDogPhoto(): Promise<ActionResult> {
  try {
    const existing = await db
      .select({ pathname: dogProfile.photoPathname })
      .from(dogProfile)
      .where(eq(dogProfile.id, PROFILE_ROW_ID))
      .get();
    if (!existing) return { ok: false, error: ROW_MISSING };
    // すでに写真が無いなら成功として返す。二重送信で「消せません」と
    // 言われても、押した人に打つ手が無い
    if (existing.pathname === null) return { ok: true };

    await db
      .update(dogProfile)
      .set({
        photoPathname: null,
        photoContentType: null,
        photoSizeBytes: null,
        photoUpdatedAt: null,
        updatedAt: now(),
      })
      .where(eq(dogProfile.id, PROFILE_ROW_ID))
      .run();

    await deleteBlobs([existing.pathname]);
    revalidateProfile();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, "写真の削除に失敗しました"),
    };
  }
}

/**
 * プロフィールに紐づかなかった写真を Blob から消す。
 *
 * ブラウザ → Blob の直アップロードは成功したのに、そのあとの setDogPhoto が
 * 失敗する経路がある（モバイルの通信断が典型）。そのままだと DB がどこからも
 * 指していない画像が private ストアに残り続ける。
 *
 * **kind ごとに Action を足す。共有 Action を広げない。**
 * これは profile/ 専用で、actions-log.ts の discardUnattachedPhoto は
 * vaccinations/ 専用。接頭辞を許可リストにしたことで2つは相互排他になって
 * いるので、「参照している全テーブルを列挙して確認する」という形
 * （1つ書き忘れた瞬間に生きた写真が消える）を作らずに済んでいる。
 * 3つ目の用途を足すときも、条件を緩めるのではなく Action を足すこと。
 */
export async function discardUnattachedDogPhoto(pathname: string): Promise<ActionResult> {
  try {
    if (typeof pathname !== "string" || parseBlobPath(pathname)?.kind !== "profile") {
      return { ok: false, error: "写真の保存先が不正です" };
    }
    // DB が参照している pathname は絶対に消さない。クライアント由来の値を
    // 受け取るので、この1本が「表示中の写真を消させない」保証になる
    const linked = await db
      .select({ id: dogProfile.id })
      .from(dogProfile)
      .where(eq(dogProfile.photoPathname, pathname))
      .get();
    if (linked) return { ok: false, error: "この写真はプロフィールに紐づいています" };

    await deleteBlobs([pathname]);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, "写真の削除に失敗しました"),
    };
  }
}
