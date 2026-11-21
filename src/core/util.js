// util.js — ids, paise money, IST dates, CSV with BOM, validation (§4.4, §6.1)

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function makeId(len = 16) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  for (let b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}

export function makeClientUuid() {
  return makeId(22);
}

// Money in paise (integer). All money math uses integers to avoid rounding bugs.
export function toPaise(rupees) {
  return Math.round(parseFloat(rupees) * 100);
}
export function fromPaise(paise) {
  return (paise / 100).toFixed(2);
}
export function moneyP(paise) {
  if (paise == null) return '₹0';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}

// Stage amount = floor(agreed_price_paise × pct_bp ÷ 10000); remainder added to last stage
export function stageAmount(agreedPricePaise, pctBp) {
  return Math.floor((agreedPricePaise * pctBp) / 10000);
}
export function gstPaise(amountPaise, gstBp) {
  return Math.round((amountPaise * gstBp) / 10000);
}

// Dates — timestamps stored UTC as YYYY-MM-DD HH:MM:SS, displayed IST.
// Date-only columns hold YYYY-MM-DD (IST calendar dates).
export function nowUtc() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}
export function toUtcString(date) {
  return date.toISOString().replace('T', ' ').substring(0, 19);
}
export function dateIST(utcText) {
  if (!utcText) return '—';
  const d = new Date(utcText + ' UTC');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
export function dateTimeIST(utcText) {
  if (!utcText) return '—';
  const d = new Date(utcText + ' UTC');
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
export function addDays(dateStr, days) {
  const d = new Date(dateStr + ' UTC');
  d.setUTCDate(d.getUTCDate() + days);
  return toUtcString(d);
}

// Phone: store as +91XXXXXXXXXX
export function normalizePhone(phone) {
  let p = String(phone).replace(/\s/g, '');
  if (p.startsWith('+91')) return p;
  if (p.startsWith('91') && p.length === 12) return '+' + p;
  if (p.startsWith('0')) p = p.substring(1);
  if (p.length === 10) return '+91' + p;
  return p;
}

// CSV with BOM so ₹ and Indian names render correctly in Excel
export function csvBom(rows) {
  const lines = rows.map((r) => r.map((c) => {
    const s = String(c == null ? '' : c);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }).join(','));
  return '\uFEFF' + lines.join('\n');
}

// Validation
export function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}
export function isValidPhone(p) {
  return /^\+91\d{10}$/.test(p);
}

// Sleep helper for retry loops
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
