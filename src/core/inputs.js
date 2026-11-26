// core/inputs.js — one check on every JSON body the server receives (router.js runs it before any route).
// 1. The body must be a plain object of plain values: no tricks such as "__proto__", no deep nesting, no huge text.
// 2. Fields the server always fills in itself (who created or changed a record, and when) are dropped, so a request
//    can never set them on someone's behalf. Every route already reads only the fields it names; this makes it certain.
// 3. Each top-level field is checked by its name, the naming rule the whole database follows (docs/DATA_DICTIONARY.md):
//    *_paise money, *_bp percentages, *_on / *_date dates, phone, email, *_id, *_sqft areas, counts, PAN, GSTIN, IFSC.
//    A wrong value is refused with a plain-language message before the route runs.
// Cost: no database query; one walk over the body (a few hundred fields at most).

// Filled in by the server only. Never accepted from a browser.
export const SERVER_FIELDS = new Set(['created_by', 'created_at', 'updated_by', 'updated_at', 'deleted_at', 'deleted_by', 'erased_at',
  'password_hash', 'password_salt', 'is_primary_owner', 'reversed_at', 'reversed_by', 'approved_by', 'approved_at', 'by_user', 'uploaded_by']);
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const MAX_DEPTH = 6, MAX_KEYS = 5000, MAX_TEXT = 200000;
const MAX_PAISE = 1e13;          // ₹1 lakh crore: far above any real figure, below where whole-number maths stops being exact
const MAX_SQFT = 10000000;        // 1 crore sq ft
// Money fields that may be below zero (a correction, a difference or an opening balance).
const SIGNED_PAISE = /(^|_)(adjust|adjustment|delta|diff|difference|variance|change|net|balance|opening|closing)(_|$)/;

const blank = (v) => v === null || v === undefined || v === '';
const isNum = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()));
const human = (k) => k.replace(/_(paise|bp|id|on|sqft|sqm)$/, '').replace(/_/g, ' ');

export function realDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}
const dateTime = (s) => { const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(String(s)); return !!m && realDate(m[1]) && (m[2] === undefined || (+m[2] < 24 && +m[3] < 60 && (m[4] === undefined || +m[4] < 60))); };
export function phoneDigits(v) {
  let d = String(v).replace(/[\s\-().+]/g, '');
  if (!/^\d+$/.test(d)) return '';
  // the last 10 digits, after a country code or trunk prefix: +91, 91, 0, 00, 091, 0091
  if (d.length > 10 && ['0', '00', '91', '091', '0091'].includes(d.slice(0, d.length - 10))) d = d.slice(-10);
  return d.length === 10 ? d : '';
}

const DATE_KEY = /(^|_)(date|on)$/;
const NOT_DATE = new Set(['depends_on', 'turned_on', 'carry_on', 'go_on']);
const DATETIME_KEY = new Set(['next_followup_at', 'visit_at', 'next_followup', 'scheduled_at', 'remind_at']);
const ID_TEXT = new Set(['client_uuid', 'mfa_token', 'session_id', 'drive_file_id', 'drive_folder_id', 'folder_id', 'file_id', 'calendar_id', 'event_id', 'message_id', 'request_id', 'txn_id', 'utr_id', 'payment_id', 'order_id', 'external_id', 'source_id']);

// The error message for one field, or '' when it is fine.
function checkField(k, v) {
  if (blank(v) || typeof v === 'boolean') return '';
  if (typeof v === 'object') return '';                         // nested lists and objects are walked separately
  const key = k.toLowerCase();
  if (key.endsWith('_paise')) {
    if (!isNum(v)) return `Enter ${human(key)} as an amount in rupees.`;
    const n = Number(v);
    if (Math.abs(n) > MAX_PAISE) return `The ${human(key)} amount is too large. Please check it.`;
    if (n < 0 && !SIGNED_PAISE.test(key)) return `The ${human(key)} amount cannot be negative.`;
    return '';
  }
  if (key.endsWith('_bp')) {
    if (!isNum(v)) return `Enter ${human(key)} as a percentage.`;
    const n = Number(v);
    return n < 0 || n > 10000 ? `The ${human(key)} percentage must be between 0 and 100.` : '';
  }
  if (key.endsWith('_pct') || key === 'pct' || key === 'percent_complete') {
    if (!isNum(v)) return `Enter ${human(key)} as a percentage.`;
    const n = Number(v);
    return n < 0 || n > 100 ? `The ${human(key.replace(/_pct$/, ''))} percentage must be between 0 and 100.` : '';
  }
  if (key.endsWith('_sqft') || key.endsWith('_sqm') || key === 'area') {
    if (!isNum(v)) return `Enter ${human(key)} as a number of square feet.`;
    const n = Number(v);
    return n < 0 || n > MAX_SQFT ? `Check the ${human(key)} area: it must be between 0 and 1 crore.` : '';
  }
  if (key === 'count' || key.endsWith('_count')) {
    if (!isNum(v)) return `Enter ${human(key)} as a whole number.`;
    const n = Number(v);
    return n < 0 || n > 1000000 || !Number.isInteger(n) ? `Check the ${human(key)}: it must be a whole number, 0 or more.` : '';
  }
  if (key.endsWith('_id') && !ID_TEXT.has(key)) {
    if (!isNum(v)) return `Pick ${human(key)} from the list.`;
    const n = Number(v);
    return n < 0 || !Number.isInteger(n) || n > 9007199254740991 ? `Pick ${human(key)} from the list.` : '';
  }
  if (DATETIME_KEY.has(key)) return dateTime(v) ? '' : `Enter ${human(key.replace(/_at$/, ''))} as a proper date and time.`;
  if ((DATE_KEY.test(key) && !NOT_DATE.has(key)) || key.endsWith('_expiry') || key === 'expiry' || key === 'valid_until' || key === 'period_from' || key === 'period_to' || key === 'dob') {
    if (typeof v !== 'string') return `Enter ${human(key)} as a proper date.`;
    return realDate(v.trim().slice(0, 10)) && (v.trim().length === 10 || dateTime(v.trim())) ? '' : `Enter ${human(key)} as a proper date.`;
  }
  if (key === 'month') return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v)) ? '' : 'Pick the month.';
  if (key === 'phone' || key === 'mobile' || key === 'whatsapp' || key.endsWith('_phone') || key.endsWith('_mobile')) {
    return phoneDigits(v) ? '' : 'Enter a 10-digit mobile or phone number (a +91 or 0 in front is fine).';
  }
  if (key === 'email' || key.endsWith('_email')) {
    const s = String(v).trim();
    return s.length <= 200 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/.test(s) ? '' : 'Enter a proper email address, like name@example.com.';
  }
  if (key === 'pan' || key.endsWith('_pan')) return /^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(String(v).trim()) ? '' : 'The PAN must look like ABCDE1234F.';
  if (key === 'gstin' || key.endsWith('_gstin')) return /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/i.test(String(v).trim()) ? '' : 'The GSTIN must be 15 characters, like 27ABCDE1234F1Z5.';
  if (key === 'ifsc' || key.endsWith('_ifsc')) return /^[A-Z]{4}0[A-Z0-9]{6}$/i.test(String(v).trim()) ? '' : 'The IFSC must be 11 characters, like SBIN0001234.';
  if (typeof v === 'number' && !Number.isFinite(v)) return `Check ${human(key)}.`;
  if (typeof v === 'string' && v.length > MAX_TEXT) return `The ${human(key)} text is too long.`;
  return '';
}

// Checks and cleans a parsed JSON body. Returns { body } (server-owned fields removed) or { error }.
export function checkBody(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return { error: 'That request was not in the expected shape. Please refresh the page and try again.' };
  let keys = 0;
  const walk = (o, depth, top) => {
    if (depth > MAX_DEPTH) return 'That request was not in the expected shape. Please refresh the page and try again.';
    if (Array.isArray(o)) {
      for (const x of o) {
        if (++keys > MAX_KEYS) return 'That request is too large.';
        if (x && typeof x === 'object') { const e = walk(x, depth + 1, false); if (e) return e; }
        else if (typeof x === 'string' && x.length > MAX_TEXT) return 'That request is too large.';
      }
      return '';
    }
    for (const k of Object.keys(o)) {
      if (++keys > MAX_KEYS) return 'That request is too large.';
      if (BAD_KEYS.has(k)) return 'That request was not in the expected shape. Please refresh the page and try again.';
      if (SERVER_FIELDS.has(k)) { delete o[k]; continue; }
      const v = o[k];
      if (v && typeof v === 'object') { const e = walk(v, depth + 1, false); if (e) return e; continue; }
      if (top) { const e = checkField(k, v); if (e) return e; }   // lists of rows (imports, bank lines) are checked row by row by their own route, which names the line
    }
    return '';
  };
  const error = walk(input, 0, true);
  return error ? { error } : { body: input };
}

// A settings value (Settings screen), checked by the last part of its key: tax.gst_bp is a percentage, po.pm_approval_limit_paise
// an amount, interest.grace_days a count of days. Returns the message, or ''. Text and on/off settings are left to their screens.
export function checkSetting(key, value) {
  const tail = String(key).split('.').pop();
  if (value === null || value === undefined || value === '' || typeof value === 'object' || typeof value === 'boolean') return '';
  const e = checkField(tail, value);
  if (e) return e;
  if (/(_days|_day|_months|_years|_mb|_views|_percent|_limit|_holds_per_user)$/.test(tail)) {
    const n = Number(value);
    if (!isNum(value) || n < 0 || n > 1000000) return 'Enter a number, 0 or more.';
    if (tail.endsWith('_percent') && n > 100) return 'A percentage cannot be more than 100.';
  }
  return '';
}
