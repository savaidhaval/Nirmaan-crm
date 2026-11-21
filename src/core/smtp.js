// core/smtp.js — Workers transport for the SMTP client (cloudflare:sockets).
// 465 = implicit TLS (recommended). 587 = STARTTLS. Never port 25 (blocked on Workers).
import { connect } from 'cloudflare:sockets';
import { SmtpLink, SmtpError, runSession } from './smtp-protocol.js';

export async function sendSmtp(cfg, message) {
  const port = Number(cfg.port) || 465;
  if (port === 25) throw new SmtpError('Port 25 is not available. Use 465 (SSL/TLS) or 587 (STARTTLS).');
  const starttls = cfg.security === 'starttls' || (cfg.security !== 'ssl' && port === 587);
  let socket;
  try {
    socket = connect({ hostname: cfg.host, port }, { secureTransport: starttls ? 'starttls' : 'on', allowHalfOpen: false });
    await Promise.race([socket.opened, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000))]);
  } catch (e) {
    throw new SmtpError(`Could not connect to ${cfg.host}:${port}. Check the host and port (465 with SSL/TLS, or 587 with STARTTLS).`);
  }
  let link = new SmtpLink(socket.readable.getReader(), socket.writable.getWriter());
  try {
    const upgrade = starttls ? async () => {
      link.reader.releaseLock(); link.writer.releaseLock();
      const secured = socket.startTls();
      link = new SmtpLink(secured.readable.getReader(), secured.writable.getWriter());
      return link;
    } : null;
    return await runSession({ link, upgrade, cfg, message });
  } finally {
    try { await socket.close(); } catch (e) { /* ignore */ }
  }
}
