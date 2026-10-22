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

function getTransporter() {
    const port = Number(process.env.SMTP_PORT || 587);
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
      requireTLS: process.env.NODE_ENV === 'production' && port !== 465,
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
      disableFileAccess: true, disableUrlAccess: true,
    });
}

export async function sendMail({ to, subject, html, attachments = [] }) {
  const message = { from: process.env.SMTP_FROM || 'NTI-T Shopp <no-reply@ntitshopp.local>', to, subject, html, attachments };
  if (process.env.SMTP_HOST) {
    const result = await getTransporter().sendMail(message);
    if (!result.accepted?.length || result.rejected?.length) throw new Error('E-postservern tog inte emot mottagaren.');
    return 'smtp';
  }
  await mkdir(OUTBOX_DIR, { recursive: true });
  const base = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`;
  const name = `${base}.html`;
  const envelope = `<!-- To: ${to}\n     Subject: ${subject} -->\n${html}`;
  await writeFile(path.join(OUTBOX_DIR, name), envelope, 'utf8');
  // A complete MIME message lets the local demo verify the actual attachment.
  const local = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const rendered = await local.sendMail(message);
  await writeFile(path.join(OUTBOX_DIR, `${base}.eml`), rendered.message);
  for (const attachment of attachments) {
    const filename = path.basename(attachment.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    await writeFile(path.join(OUTBOX_DIR, `${base}-${filename}`), attachment.content);
  }
  console.log(`[mail] SMTP ej konfigurerad – mailet till ${to} sparas i backend/mail-outbox/${name}`);
  return 'outbox';
}
