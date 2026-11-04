'use strict';
/* App-Installation (PWA), Offline-Hinweis und Aufraeumen des Offline-Caches */
(function () {
  let banner = null;
  let offline = false;

  function ensureBanner() {
    if (banner) return banner;
    banner = document.createElement('div');
    banner.id = 'offline-banner';
    banner.setAttribute('role', 'status');
    banner.hidden = true;
    banner.textContent = 'Offline – es werden die zuletzt geladenen Daten angezeigt. Änderungen sind erst mit Verbindung möglich.';
    document.body.prepend(banner);
    return banner;
  }
  window.lwOffline = function (value) {
    if (value === offline) return;
    offline = value;
    ensureBanner().hidden = !value;
    document.body.classList.toggle('is-offline', value);
  };
  window.addEventListener('offline', () => window.lwOffline(true));
  window.addEventListener('online', () => {
    window.lwOffline(false);
    if (typeof route === 'function' && state && state.user) route();
  });

  window.lwClearOfflineData = function () {
    try { if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ type: 'clear-api' }); } catch { /* egal */ }
  };

  // Installieren (Android/Chrome/Edge); iPhone: Anleitung in den Einstellungen
  window.lwInstallEvent = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.lwInstallEvent = e;
    document.dispatchEvent(new CustomEvent('lw-installable'));
  });
  window.addEventListener('appinstalled', () => { window.lwInstallEvent = null; document.dispatchEvent(new CustomEvent('lw-installed')); });
  window.lwIsStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
  }
})();
