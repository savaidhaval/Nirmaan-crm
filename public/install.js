// install.js — "Install the app" for iPhone/iPad, Android, Windows and Mac. NirmaanCRM installs from the browser (no app store, no download file):
// Chrome and Edge offer a one-click install; Safari on iPhone/iPad and Mac uses Add to Home Screen / Add to Dock.
(function () {
  let deferred = null;
  const standalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; document.querySelectorAll('[data-install-now]').forEach((b) => { b.hidden = false; }); });
  window.addEventListener('appinstalled', () => { deferred = null; document.querySelectorAll('[data-install]').forEach((b) => { b.hidden = true; }); const m = document.getElementById('install-modal'); if (m) m.remove(); });

  function detect() {
    const ua = navigator.userAgent || '', touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    if (/iPhone|iPad|iPod/.test(ua) || touchMac) return 'ios';
    if (/Android/.test(ua)) return 'android';
    if (/Windows/.test(ua)) return 'windows';
    if (/Macintosh|Mac OS X/.test(ua)) return 'mac';
    return 'windows';
  }
  const STEPS = {
    ios: ['Open this page in <b>Safari</b>.', 'Tap the <b>Share</b> button (a square with an arrow pointing up).', 'Scroll down and tap <b>Add to Home Screen</b>.', 'Tap <b>Add</b>. NirmaanCRM now sits on your home screen like any other app.'],
    android: ['Use <b>Chrome</b>. Tap <b>Install now</b> above, or open the <b>⋮</b> menu.', 'Tap <b>Install app</b> (or <b>Add to Home screen</b>).', 'Tap <b>Install</b>. The app appears with your other apps.'],
    windows: ['Use <b>Edge</b> or <b>Chrome</b>. Click <b>Install now</b> above, or the install icon at the right end of the address bar.', 'Click <b>Install</b>.', 'NirmaanCRM opens in its own window and is added to your Start menu. Pin it to the taskbar if you like.'],
    mac: ['In <b>Chrome</b> or <b>Edge</b>: click <b>Install now</b> above, or the install icon in the address bar, then <b>Install</b>.', 'In <b>Safari</b> (version 17 or later): open the <b>File</b> menu and choose <b>Add to Dock</b>.', 'Firefox cannot install web apps. Use Safari, Chrome or Edge.'],
  };
  const NAMES = { ios: 'iPhone / iPad', android: 'Android', windows: 'Windows', mac: 'Mac' };

  function open() {
    const old = document.getElementById('install-modal'); if (old) old.remove();
    let os = detect();
    const ov = document.createElement('div'); ov.className = 'modal-overlay'; ov.id = 'install-modal';
    const draw = () => {
      ov.innerHTML = `<div class="modal" role="dialog" aria-label="Install NirmaanCRM"><div class="install-card" style="box-shadow:none;padding:0"><img class="app-icon" src="/icons/icon-192.png" alt=""><div><h2 style="margin:0">Install NirmaanCRM</h2><p class="muted">Opens like an app, full screen, from your home screen, dock or Start menu. It also keeps working on a weak signal. Nothing to download from a store.</p></div></div>
        <div class="os-tabs" role="tablist">${Object.keys(NAMES).map((k) => `<button role="tab" aria-selected="${k === os}" data-os="${k}">${NAMES[k]}</button>`).join('')}</div>
        ${(deferred && os !== 'ios') ? '<button class="btn btn-primary btn-full" data-install-now style="margin-bottom:14px">Install now</button>' : ''}
        <ol class="os-steps">${STEPS[os].map((s) => `<li>${s}</li>`).join('')}</ol>
        <div class="modal-actions"><button class="btn btn-primary" id="inst-close">Done</button></div></div>`;
      ov.querySelectorAll('[data-os]').forEach((b) => { b.onclick = () => { os = b.dataset.os; draw(); }; });
      ov.querySelector('#inst-close').onclick = () => ov.remove();
      const now = ov.querySelector('[data-install-now]'); if (now) now.onclick = async () => { try { deferred.prompt(); await deferred.userChoice; } catch (e) { /* ignore */ } deferred = null; ov.remove(); };
    };
    draw(); ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); }); document.body.appendChild(ov);
  }
  window.nirmaanInstall = { open, standalone, detect };
  document.addEventListener('DOMContentLoaded', () => { document.querySelectorAll('[data-install]').forEach((b) => { if (standalone()) b.hidden = true; else b.onclick = open; }); });
})();
