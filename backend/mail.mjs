// ShopIT backend – orderbekräftelsemail.
// Med SMTP_HOST satt skickas mailet via nodemailer. Utan SMTP konfiguration
// (lokal demo) sparas mailet som HTML i backend/mail-outbox/ och loggas.
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import nodemailer from 'nodemailer';

const OUTBOX_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mail-outbox');

export function mailDeliveryMode() {
  return process.env.SMTP_HOST ? 'smtp' : 'outbox';
}

let transporter = null;

function getTransporter() {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 587);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
    });
  }
  return transporter;
}

export async function sendMail({ to, subject, html }) {
  if (process.env.SMTP_HOST) {
    await getTransporter().sendMail({
      from: process.env.SMTP_FROM || 'NTI-T Shopp <no-reply@ntitshopp.local>',
      to,
      subject,
      html,
    });
    return 'smtp';
  }
  await mkdir(OUTBOX_DIR, { recursive: true });
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}.html`;
  const envelope = `<!-- To: ${to}\n     Subject: ${subject} -->\n${html}`;
  await writeFile(path.join(OUTBOX_DIR, name), envelope, 'utf8');
  console.log(`[mail] SMTP ej konfigurerad – mailet till ${to} sparas i backend/mail-outbox/${name}`);
  return 'outbox';
}
