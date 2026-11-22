'use strict';
// Booking tools: slot availability & session hygiene (100% English)
(()=>{
  try { localStorage.removeItem('rl_operations_language'); } catch {}
  document.documentElement.lang = 'en';

  const optionOriginal = new WeakMap();
  let dateKey = null;
  let busy = false;

  async function availability() {
    const f = document.getElementById('booking-form');
    const d = f?.querySelector('[name=date]');
    const sel = f?.querySelector('[name=slot]');
    if (!f || !d || !sel) { dateKey = null; return; }

    const value = d.value;
    if (dateKey === f.id + ':' + value && f.dataset.availability === '1') return;
    dateKey = f.id + ':' + value;
    f.dataset.availability = '1';

    for (const o of sel.options) {
      if (!optionOriginal.has(o)) optionOriginal.set(o, { value: o.value, label: o.textContent });
      const old = optionOriginal.get(o);
      o.value = old.value;
      o.disabled = false;
    }

    let info = f.querySelector('[data-availability]');
    if (!info) {
      info = document.createElement('small');
      info.dataset.availability = '';
      info.setAttribute('aria-live', 'polite');
      sel.after(info);
    }
    if (!value) { info.textContent = ''; return; }

    try {
      const r = await fetch('/api/extended/availability?date=' + encodeURIComponent(value), { cache: 'no-store' });
      if (!r.ok) throw Error();
      const rows = await r.json();
      if (d.value !== value || !f.isConnected) return;
      for (const o of sel.options) {
        const row = rows.find(x => x.slot === o.value);
        if (row?.remaining === 0) {
          o.disabled = true;
          if (o.selected) sel.value = '';
        }
      }
      info.textContent = rows.map(row => row.slot + ': ' + (row.remaining === null ? 'on request' : row.remaining)).join(' · ');
    } catch {
      info.textContent = 'The shop will confirm availability.';
    }
  }

  function update() {
    if (busy) return;
    busy = true;
    try {
      document.querySelectorAll('[data-booking-lang]').forEach(b => b.remove());
      for (const o of document.querySelectorAll('#booking-form select option')) {
        if (!optionOriginal.has(o)) optionOriginal.set(o, { value: o.value, label: o.textContent });
        o.value = optionOriginal.get(o).value;
      }
      void availability();
    } finally {
      busy = false;
    }
  }

  document.addEventListener('change', e => {
    if (e.target.matches('#booking-form [name=date]')) {
      delete e.target.form.dataset.availability;
      void availability();
    }
  });

  const observer = new MutationObserver(update);
  observer.observe(document.body, { childList: true, subtree: true });
  update();
})();
