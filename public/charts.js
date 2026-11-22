// charts.js — small SVG/HTML charts with no library. Colours come from CSS variables (--s1..--s8, light and dark).
// Rules followed: thin marks, one axis, direct value labels, a legend for 2+ series, hover tooltips (native <title>),
// and a "Show as table" view so nothing depends on colour alone.
const CH = {
  esc: (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  color: (i) => `var(--s${(i % 8) + 1})`,
  short: (n) => { n = Number(n) || 0; const a = Math.abs(n); return a >= 1e7 ? (n / 1e7).toFixed(a >= 1e8 ? 0 : 1).replace(/\.0$/, '') + ' Cr' : a >= 1e5 ? (n / 1e5).toFixed(1).replace(/\.0$/, '') + ' L' : a >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(n)); },
};
// Money in paise shown short, e.g. "₹2.5 Cr"
CH.rupees = (paise) => '₹' + CH.short((Number(paise) || 0) / 100);

// A "table view" for any chart: rows = [[label, value, ...], ...]
CH.table = (head, rows) => `<details class="ch-table"><summary>Show as table</summary><table><tr>${head.map((h) => `<th>${CH.esc(h)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${CH.esc(c)}</td>`).join('')}</tr>`).join('')}</table></details>`;

CH.legend = (names) => names.length < 2 ? '' : `<div class="ch-legend">${names.map((n, i) => `<span><i style="background:${CH.color(i)}"></i>${CH.esc(n)}</span>`).join('')}</div>`;

// Horizontal bars: items = [{label, value, text?}]. One series, labelled directly.
CH.hbars = (items, { title = '', fmt = (v) => String(v), color = 0 } = {}) => {
  if (!items.length) return '<p class="muted">Nothing to show yet.</p>';
  const max = Math.max(...items.map((i) => i.value), 1);
  return `<div class="ch" role="img" aria-label="${CH.esc(title)}">${title ? `<div class="ch-title">${CH.esc(title)}</div>` : ''}${items.map((i) => `<div class="ch-hrow" title="${CH.esc(i.label)}: ${CH.esc(i.text || fmt(i.value))}">
    <div class="ch-hlabel">${CH.esc(i.label)}</div><div class="ch-htrack"><div class="ch-hbar" style="width:${Math.max(2, Math.round((i.value / max) * 100))}%;background:${CH.color(i.color != null ? i.color : color)}"></div></div><div class="ch-hval">${CH.esc(i.text || fmt(i.value))}</div></div>`).join('')}
    ${CH.table(['Item', 'Value'], items.map((i) => [i.label, i.text || fmt(i.value)]))}</div>`;
};

// Vertical columns over time: points = [{label, value}]. Marks only on the extremes to avoid clutter.
CH.columns = (points, { title = '', fmt = (v) => String(v), height = 120, color = 0 } = {}) => {
  if (!points.length) return '<p class="muted">Nothing to show yet.</p>';
  const W = 600, H = height, pad = 18, n = points.length, max = Math.max(...points.map((p) => p.value), 1);
  const bw = Math.max(2, Math.min(18, (W - 20) / n - 3)), step = (W - 20) / n;
  const bars = points.map((p, i) => { const h = Math.round((p.value / max) * (H - pad - 4)); const x = 10 + i * step + (step - bw) / 2;
    return `<g><rect x="${x.toFixed(1)}" y="${H - pad - h}" width="${bw}" height="${Math.max(h, p.value ? 2 : 0)}" rx="3" fill="${CH.color(color)}"><title>${CH.esc(p.label)}: ${CH.esc(fmt(p.value))}</title></rect></g>`; }).join('');
  const peak = points.reduce((b, p, i) => p.value > points[b].value ? i : b, 0);
  const tx = (i) => Math.min(W - 24, Math.max(24, 10 + i * step + step / 2));
  const labels = `<text x="${tx(0)}" y="${H - 3}" class="ch-ax" text-anchor="middle">${CH.esc(points[0].label)}</text>${n > 1 ? `<text x="${tx(n - 1)}" y="${H - 3}" class="ch-ax" text-anchor="middle">${CH.esc(points[n - 1].label)}</text>` : ''}`;
  const peakLbl = points[peak].value ? `<text x="${tx(peak)}" y="${Math.max(10, H - pad - Math.round((points[peak].value / max) * (H - pad - 4)) - 4)}" class="ch-pk" text-anchor="middle">${CH.esc(fmt(points[peak].value))}</text>` : '';
  return `<div class="ch" role="img" aria-label="${CH.esc(title)}">${title ? `<div class="ch-title">${CH.esc(title)}</div>` : ''}<svg viewBox="0 0 ${W} ${H}" class="ch-svg" preserveAspectRatio="none"><line x1="10" x2="${W - 10}" y1="${H - pad}" y2="${H - pad}" class="ch-base"/>${bars}${peakLbl}${labels}</svg>
    ${CH.table(['Day', 'Value'], points.map((p) => [p.label, fmt(p.value)]))}</div>`;
};

// Grouped columns for 2+ series: groups = [{label, values:[v1, v2]}], names = ['Cost', 'Revenue'] (legend always shown).
CH.grouped = (groups, names, { title = '', fmt = (v) => String(v), height = 170 } = {}) => {
  if (!groups.length) return '<p class="muted">Nothing to show yet.</p>';
  const W = 600, H = height, pad = 20, n = groups.length, k = names.length, max = Math.max(...groups.flatMap((g) => g.values.map((v) => v || 0)), 1);
  const step = (W - 20) / n, bw = Math.max(4, Math.min(26, (step - 10) / k - 2));
  const out = groups.map((g, gi) => { const x0 = 10 + gi * step + (step - (bw + 2) * k) / 2;
    return g.values.map((v, si) => { const h = Math.round(((v || 0) / max) * (H - pad - 14)); const x = x0 + si * (bw + 2);
      return `<rect x="${x.toFixed(1)}" y="${H - pad - h}" width="${bw}" height="${Math.max(h, v ? 2 : 0)}" rx="3" fill="${CH.color(si)}"><title>${CH.esc(g.label)} · ${CH.esc(names[si])}: ${CH.esc(fmt(v || 0))}</title></rect>${v ? `<text x="${(x + bw / 2).toFixed(1)}" y="${H - pad - h - 3}" class="ch-pk" text-anchor="middle">${CH.esc(fmt(v))}</text>` : ''}`; }).join('') +
      `<text x="${(10 + gi * step + step / 2).toFixed(1)}" y="${H - 5}" class="ch-ax" text-anchor="middle">${CH.esc(g.label)}</text>`; }).join('');
  return `<div class="ch" role="img" aria-label="${CH.esc(title)}">${title ? `<div class="ch-title">${CH.esc(title)}</div>` : ''}${CH.legend(names)}<svg viewBox="0 0 ${W} ${H}" class="ch-svg"><line x1="10" x2="${W - 10}" y1="${H - pad}" y2="${H - pad}" class="ch-base"/>${out}</svg>
    ${CH.table(['Group', ...names], groups.map((g) => [g.label, ...g.values.map((v) => fmt(v || 0))]))}</div>`;
};

// Line over time (one series): points = [{label, value}] with a dot on the last point and a label on it.
CH.line = (points, { title = '', fmt = (v) => String(v), height = 120, suffix = '' } = {}) => {
  const pts = points.filter((p) => p.value != null);
  if (pts.length < 2) return '<p class="muted">Needs at least two points to draw a line.</p>';
  const W = 600, H = height, pad = 18, max = Math.max(...pts.map((p) => p.value)), min = Math.min(...pts.map((p) => p.value)), span = max - min || 1;
  const X = (i) => 14 + (i * (W - 28)) / (pts.length - 1), Y = (v) => 14 + (1 - (v - min) / span) * (H - pad - 22);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p.value).toFixed(1)}`).join(' ');
  const dots = pts.map((p, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.value).toFixed(1)}" r="${i === pts.length - 1 ? 5 : 3.5}" fill="${CH.color(0)}" stroke="var(--surface)" stroke-width="2"><title>${CH.esc(p.label)}: ${CH.esc(fmt(p.value))}${suffix}</title></circle>`).join('');
  const last = pts[pts.length - 1];
  return `<div class="ch" role="img" aria-label="${CH.esc(title)}">${title ? `<div class="ch-title">${CH.esc(title)}</div>` : ''}<svg viewBox="0 0 ${W} ${H}" class="ch-svg"><line x1="10" x2="${W - 10}" y1="${H - pad}" y2="${H - pad}" class="ch-base"/>
    <path d="${path}" fill="none" stroke="${CH.color(0)}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${dots}
    <text x="${Math.min(W - 30, X(pts.length - 1))}" y="${Math.max(10, Y(last.value) - 9)}" class="ch-pk" text-anchor="middle">${CH.esc(fmt(last.value))}${suffix}</text>
    <text x="14" y="${H - 4}" class="ch-ax">${CH.esc(pts[0].label)}</text><text x="${W - 14}" y="${H - 4}" class="ch-ax" text-anchor="end">${CH.esc(last.label)}</text></svg>
    ${CH.table(['Point', 'Value'], pts.map((p) => [p.label, fmt(p.value) + suffix]))}</div>`;
};

// Share of a whole as a ring with a legend and the total in the middle. items = [{label, value}] (up to 6; the rest fold into "Other").
CH.donut = (items, { title = '', fmt = (v) => String(v), center = '' } = {}) => {
  let list = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  if (!list.length) return '<p class="muted">Nothing to show yet.</p>';
  if (list.length > 6) { const rest = list.slice(5).reduce((s, i) => s + i.value, 0); list = [...list.slice(0, 5), { label: 'Other', value: rest }]; }
  const total = list.reduce((s, i) => s + i.value, 0), R = 52, C = 2 * Math.PI * R; let off = 0;
  const arcs = list.map((i, idx) => { const len = (i.value / total) * C; const a = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${CH.color(idx)}" stroke-width="16" stroke-dasharray="${Math.max(0, len - 2).toFixed(2)} ${(C - Math.max(0, len - 2)).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 70 70)"><title>${CH.esc(i.label)}: ${CH.esc(fmt(i.value))} (${Math.round((i.value / total) * 100)}%)</title></circle>`; off += len; return a; }).join('');
  return `<div class="ch" role="img" aria-label="${CH.esc(title)}">${title ? `<div class="ch-title">${CH.esc(title)}</div>` : ''}<div class="ch-donut"><svg viewBox="0 0 140 140" width="140" height="140">${arcs}<text x="70" y="75" text-anchor="middle" class="ch-ctr">${CH.esc(center || fmt(total))}</text></svg>
    <div class="ch-legend v">${list.map((i, idx) => `<span><i style="background:${CH.color(idx)}"></i>${CH.esc(i.label)} <b>${CH.esc(fmt(i.value))}</b> <em>${Math.round((i.value / total) * 100)}%</em></span>`).join('')}</div></div>
    ${CH.table(['Item', 'Value'], list.map((i) => [i.label, fmt(i.value)]))}</div>`;
};

// A single progress bar with a target marker: used for "deposited vs required" style checks.
CH.meter = (value, total, { label = '', text = '' } = {}) => {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return `<div class="ch-meter" title="${CH.esc(label)} ${pct}%"><div class="ch-mtrack"><div class="ch-mfill" style="width:${pct}%"></div></div><div class="ch-mtext">${CH.esc(text || pct + '%')}</div></div>`;
};
