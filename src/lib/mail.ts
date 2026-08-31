import "server-only";

import {
  buildMailConfig,
  classifySmtpError,
  type RemindError,
} from "@/lib/mail-config";

/**
 * Gmail の SMTP で1通送る。
 *
 * Vercel の Function は **25番ポートを塞いでいるが 465 と 587 は通る**
 * （Node.js runtime のみ）。既定は 465（暗黙TLS）。塞がれていたときの
 * 逃げ道として SMTP_HOST / SMTP_PORT で差し替えられるようにしてある。
 *
 * nodemailer は動的 import。設定が無い環境のバンドルに巻き込まないため
 * （blob.ts が @vercel/blob をそうしているのと同じ）。
 */

const DEFAULT_PORT = 465;

export function isMailConfigured(): boolean {
  return buildMailConfig(process.env) !== null;
}

export async function sendMail(input: {
  subject: string;
  text: string;
}): Promise<{ ok: true } | { ok: false; reason: RemindError }> {
  const config = buildMailConfig(process.env);
  if (!config) return { ok: false, reason: "config" };

  let nodemailer: typeof import("nodemailer");
  try {
    nodemailer = await import("nodemailer");
  } catch {
    console.error("[reminder] nodemailer を読み込めない");
    return { ok: false, reason: "config" };
  }

  const port = Number(process.env.SMTP_PORT ?? DEFAULT_PORT) || DEFAULT_PORT;
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST?.trim() || "smtp.gmail.com",
    port,
    // 465 は最初からTLS、587 は STARTTLS で昇格する
    secure: port === 465,
    auth: { user: config.user, pass: config.appPassword },
    // Function の maxDuration より内側で必ず諦める
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  try {
    await transport.sendMail({
      from: config.user,
      to: config.to.join(", "),
      subject: input.subject,
      text: input.text,
    });
    return { ok: true };
  } catch (err) {
    // メッセージ全文は宛先を含むので記録しない。種別だけ残す
    const reason = classifySmtpError(err);
    console.error(`[reminder] 送信に失敗 reason=${reason}`);
    return { ok: false, reason };
  } finally {
    transport.close();
  }
}
