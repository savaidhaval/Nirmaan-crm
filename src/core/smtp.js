// core/smtp.js — SMTP client over cloudflare:sockets (§7.8 notes 1-4)
import { connect } from 'cloudflare:sockets';

const ENC = new TextEncoder();
const DEC = new TextDecoder();

export async function sendSmtp(env, to, subject, html, fromName, fromEmail, host, port, username, password) {
  const secure = port === 465;
  const socket = connect({ hostname: host, port: port }, { secureTransport: secure ? 'on' : 'starttls' });

  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();

  let tlsSocket = socket;
  if (!secure) {
    // 587 STARTTLS: read greeting, EHLO, STARTTLS, upgrade, EHLO again
    await readResponse(reader, DEC);
    await sendCmd(writer, ENC, 'EHLO nirmaancrm');
    await readResponse(reader, DEC);
    await sendCmd(writer, ENC, 'STARTTLS');
    await readResponse(reader, DEC);
    // Upgrade: create new socket from TLS
    const tls = socket.startTls ? socket.startTls() : socket;
    if (tls !== socket) {
      reader.releaseLock();
      writer.releaseLock();
      const r2 = tls.readable.getReader();
      const w2 = tls.writable.getWriter();
      await sendCmd(w2, ENC, 'EHLO nirmaancrm');
      await readResponse(r2, DEC);
      return doSmtpAuth(tls, r2, w2, DEC, ENC, username, password, fromName, fromEmail, to, subject, html);
    }
  }

  return doSmtpAuth(tlsSocket, reader, writer, DEC, ENC, username, password, fromName, fromEmail, to, subject, html);
}

async function doSmtpAuth(socket, reader, writer, DEC, ENC, username, password, fromName, fromEmail, to, subject, html) {
  await readResponse(reader, DEC); // 220 greeting
  await sendCmd(writer, ENC, 'EHLO nirmaancrm');
  await readResponse(reader, DEC);
  await sendCmd(writer, ENC, 'AUTH LOGIN');
  await readResponse(reader, DEC);
  await sendCmd(writer, ENC, btoa(username));
  await readResponse(reader, DEC);
  await sendCmd(writer, ENC, btoa(password));
  await readResponse(reader, DEC);

  await sendCmd(writer, ENC, `MAIL FROM:<${fromEmail}>`);
  await readResponse(reader, DEC);
  await sendCmd(writer, ENC, `RCPT TO:<${to}>`);
  await readResponse(reader, DEC);
  await sendCmd(writer, ENC, 'DATA');
  await readResponse(reader, DEC);

  const headers =
    `From: ${fromName} <${fromEmail}>\r\n` +
    `To: <${to}>\r\n` +
    `Subject: ${subject}\r\n` +
    `Date: ${new Date().toUTCString()}\r\n` +
    `Message-ID: <${makeId()}@nirmaancrm>\r\n` +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: text/html; charset=UTF-8\r\n\r\n`;
  await sendCmd(writer, ENC, headers + html + '\r\n.');
  await readResponse(reader, DEC);
  await sendCmd(writer, ENC, 'QUIT');
  await readResponse(reader, DEC);

  writer.releaseLock();
  reader.releaseLock();
  socket.close();
  return { ok: true };
}

async function sendCmd(writer, ENC, cmd) {
  await writer.write(ENC.encode(cmd + '\r\n'));
}

async function readResponse(reader, DEC) {
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += DEC.decode(value, { stream: true });
    if (buf.includes('\n')) break;
  }
  return buf.trim();
}

function makeId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = '';
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (const b of bytes) s += alpha[b % alpha.length];
  return s;
}
