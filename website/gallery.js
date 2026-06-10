// Gallery — real catalog, static showcase. All 47 masks ship in the app.
// Accounts / upload (Supabase) are deferred post-MVP — see _deferred/ + RELEASE-PLAN.md.
// No localStorage "accounts", no localhost demo, no innerHTML of untrusted data.
const $ = (s) => document.querySelector(s);
const toast = (m) => {
  const t = $('#toast'); t.textContent = m; t.classList.add('show');
  clearTimeout(t._); t._ = setTimeout(() => t.classList.remove('show'), 2600);
};
// Defensive escape — catalog is first-party today, but never interpolate raw.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Real china_web categories -> user-facing labels.
const CAT_LABEL = { HAND: 'Hands', FACE: 'Face', PURE: 'Filters', EXPERIMENTAL: 'Lab' };
const TABS = ['All', 'HAND', 'FACE', 'PURE', 'EXPERIMENTAL'];
let CATALOG = [];
let filter = 'All';
const pad = (n) => String(n).padStart(2, '0');

function plate(m, no) {
  const cat = esc(CAT_LABEL[m.category] || m.category);
  const title = esc(m.title);
  // strict allow-list for the preview path — drop anything that isn't a mask webp
  const img = String(m.img);
  if (!/^assets\/masks\/[a-z0-9_.-]+\.webp$/i.test(img)) return '';
  return `<article class="mask">
    <img class="thumb" src="./${img}" alt="${title} mask preview" loading="lazy" width="320" height="320"/>
    <div class="scrim"></div>
    <div class="no">No.&nbsp;${no}</div>
    <div class="meta"><div class="row"><h4>${title}</h4><span class="tag">${cat}</span></div>
      ${m.subtitle ? `<div class="sub">${esc(m.subtitle)}</div>` : ''}</div>
  </article>`;
}

function renderTabs() {
  $('#tabs').innerHTML = TABS.map((c) => {
    const label = c === 'All' ? 'All' : (CAT_LABEL[c] || c);
    const n = c === 'All' ? CATALOG.length : CATALOG.filter((m) => m.category === c).length;
    const on = c === filter;
    return `<button class="tab ${on ? 'on' : ''}" data-c="${esc(c)}" aria-pressed="${on}">${esc(label)}${c !== 'All' ? ` <span class="cnt">${n}</span>` : ''}</button>`;
  }).join('');
  $('#tabs').querySelectorAll('.tab').forEach((b) => b.onclick = () => { filter = b.dataset.c; renderTabs(); renderGrid(); });
}

function renderGrid() {
  const items = filter === 'All' ? CATALOG : CATALOG.filter((m) => m.category === filter);
  $('#grid').innerHTML = items.length
    ? items.map((m, i) => plate(m, pad(i + 1))).join('')
    : `<div class="empty">No masks here yet.</div>`;
}

$('#dlBtn').onclick = () => toast('Download link coming soon — the notarized build is ready');

fetch('./site-catalog.json')
  .then((r) => r.json())
  .then((d) => { CATALOG = d.masks || []; renderTabs(); renderGrid(); })
  .catch(() => { CATALOG = []; renderTabs(); renderGrid(); toast('Could not load site-catalog.json'); });
