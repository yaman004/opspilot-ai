import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../config/logger';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** In-memory record of messages "sent" by the log transport (development and tests only). */
export const devOutbox: MailMessage[] = [];

let transporter: Transporter | null = null;

/**
 * With SMTP_URL set, mail goes through SMTP. Without it, the message is written to the server log and
 * kept in an in-memory dev outbox — it is NOT delivered to anyone, and the logs say so.
 */
export async function sendMail(msg: MailMessage): Promise<{ delivered: boolean }> {
  if (!env.SMTP_URL) {
    if (!env.isProd) {
      devOutbox.push(msg);
      if (devOutbox.length > 100) devOutbox.shift();
    }
    logger.info({ to: msg.to, subject: msg.subject }, `[mail:not-delivered — SMTP_URL not configured] ${msg.text}`);
    return { delivered: false };
  }
  transporter ??= nodemailer.createTransport(env.SMTP_URL);
  await transporter.sendMail({ from: env.MAIL_FROM, ...msg });
  return { delivered: true };
}
