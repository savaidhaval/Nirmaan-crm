// ui.js — shared helpers for all pages (§4.3 API conventions)
// api() performs fetch with the X-NirmaanCRM header and parses JSON responses.

const API_BASE = '';

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-NirmaanCRM': '1',
    ...options.headers,
  };

  let body = options.body;
  if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) {
    body = JSON.stringify(body);
  }
  if (body instanceof FormData || body instanceof Blob) delete headers['Content-Type'];
  const res = await fetch(API_BASE + path, {
    ...options,
    body,
    headers,
    credentials: 'include',
  });

  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error(res.statusText || 'Request failed');
  }

  if (!res.ok) {
    const msg = data && data.error ? data.error : `Request failed (${res.status})`;
    throw new Error(msg);
  }

  return data;
}

function toast(message, ms = 3000) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, ms);
}

function showError(containerId, message) {
  const el = document.getElementById(containerId);
  if (el) {
    el.textContent = message;
    el.style.display = 'block';
  }
}

function hideError(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.style.display = 'none';
}

function moneyP(paise) {
  if (paise == null) return '₹0';
  const rupees = (paise / 100).toFixed(2);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(parseFloat(rupees));
}

function dateIST(utcText) {
  if (!utcText) return '—';
  const d = new Date(utcText + ' UTC');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function compressFile(file, maxWidth = 1600, quality = 0.85) {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) { resolve(file); return; }
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;
      if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(resolve, file.type, quality);
    };
    img.src = URL.createObjectURL(file);
  });
}