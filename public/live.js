'use strict';
/* Sofort-Aktualisierung: der Server meldet Aenderungen (Server-Sent Events), die aktuelle Ansicht laedt sich neu. */
(function () {
  let es = null;
  let timer = null;
  let wasOpen = false;

  function busy() {
    const a = document.activeElement;
    return !!document.querySelector('dialog[open]')
      || (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))
      || !!document.querySelector('.dragging');
  }

  function fire() {
    timer = null;
    if (typeof state === 'undefined' || !state.user || typeof state.refresh !== 'function' || document.hidden) return;
    if (busy()) { timer = setTimeout(fire, 1500); return; } // Eingaben nicht stoeren, spaeter erneut versuchen
    Promise.resolve(state.refresh()).catch(() => {});
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(fire, 400); // mehrere Aenderungen kurz hintereinander bündeln
  }

  window.lwLiveStart = function () {
    if (es || !window.EventSource) return;
    es = new EventSource('/api/events');
    es.addEventListener('change', schedule);
    es.onopen = () => { if (wasOpen) schedule(); wasOpen = true; document.body.classList.add('is-live'); };
    es.onerror = () => { document.body.classList.remove('is-live'); };
  };
  window.lwLiveStop = function () {
    if (es) es.close();
    es = null; wasOpen = false;
    clearTimeout(timer); timer = null;
    document.body.classList.remove('is-live');
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
})();
