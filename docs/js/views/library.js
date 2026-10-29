import { api } from '../api.js';
import { plural, t } from '../i18n.js';
import { getPlaylists, invalidatePlaylists, likes, settings, updateSettings } from '../store.js';
import { EASE_IO, esc, h, haptic, icon, loader, promptName, reducedMotion, sheet, thumb } from '../ui.js';

// playlist ids grow with creation time, so the id stands in for the date added
const SORTS = {
  new: (a, b) => b.id - a.id,
  old: (a, b) => a.id - b.id,
  most: (a, b) => b.count - a.count || b.id - a.id,
  least: (a, b) => a.count - b.count || b.id - a.id,
};

function mosaic(covers) {
  if (!covers.length) return `<div class="mosaic mosaic--empty">${icon('library')}</div>`;
  const img = (c, px) => `<img src="${esc(thumb(c, px))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
  if (covers.length < 4) return `<div class="mosaic">${img(covers[0], 168)}</div>`;
  return `<div class="mosaic mosaic--4">${covers.map((c) => img(c, 96)).join('')}</div>`;
}

export async function render(_, nav) {
  const root = h(`<div class="view">
    <header class="view__head"><h1 class="view__title">${esc(t('nav_library'))}</h1></header>
    <div class="tiles">
      <button class="tile tile--accent" data-go="likes">${icon('shelf')}<span class="tile__title">${esc(t('lib_likes'))}</span><span class="tile__sub">${esc(plural(likes.size))}</span></button>
      <button class="tile tile--navy" data-go="history">${icon('clock')}<span class="tile__title">${esc(t('lib_history'))}</span><span class="tile__sub">&nbsp;</span></button>
    </div>
    <section class="section">
      <div class="section__head"><h2 class="section__title">${esc(t('lib_playlists'))}</h2>
        <div class="section__tools">
          <button class="link link--sort" data-sort hidden>${icon('sort')}<span></span></button>
          <button class="icon-btn icon-btn--accent" data-create aria-label="${esc(t('lib_new_playlist'))}">${icon('plus')}</button>
        </div></div>
      <div class="playlists">${loader()}</div>
    </section>
  </div>`);

  root.querySelector('[data-go="likes"]').addEventListener('click', () => nav.push('playlist', { kind: 'likes', title: t('lib_likes') }));
  root.querySelector('[data-go="history"]').addEventListener('click', () => nav.push('playlist', { kind: 'history', title: t('lib_history') }));

  const list = root.querySelector('.playlists');
  const sortBtn = root.querySelector('[data-sort]');
  let dirty = false, playlists = [];
  const rows = new Map(); // playlist id -> row element
  document.addEventListener('playlists-changed', () => { dirty = true; });

  const sortKey = () => (SORTS[settings.plSort] ? settings.plSort : 'new');

  /** Put the rows in the chosen order; existing rows glide to their new places (FLIP). */
  function arrange(animate) {
    const before = animate ? new Map([...rows].map(([id, el]) => [id, el.getBoundingClientRect().top])) : null;
    playlists.slice().sort(SORTS[sortKey()]).forEach((p) => list.append(rows.get(p.id)));
    sortBtn.querySelector('span').textContent = t('sort_' + sortKey());
    if (!before || reducedMotion()) return;
    rows.forEach((el, id) => {
      const dy = before.get(id) - el.getBoundingClientRect().top;
      if (dy) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 480, easing: EASE_IO });
    });
  }

  async function load() {
    playlists = await getPlaylists();
    list.innerHTML = '';
    rows.clear();
    sortBtn.hidden = playlists.length < 2;
    if (!playlists.length) {
      list.append(h(`<div class="empty empty--inline"><div class="empty__text">${esc(t('lib_empty_playlists'))}</div></div>`));
      return;
    }
    playlists.forEach((p) => {
      const row = h(`<button class="pl-row">${mosaic(p.covers)}
        <span class="pl-row__meta"><span class="pl-row__name">${esc(p.name)}</span><span class="pl-row__count">${esc(plural(p.count))}</span></span>
        ${icon('right', 'pl-row__chev')}</button>`);
      row.addEventListener('click', () => nav.push('playlist', { kind: 'user', id: p.id, title: p.name }));
      rows.set(p.id, row);
    });
    arrange(false);
  }

  sortBtn.addEventListener('click', async () => {
    const keys = Object.keys(SORTS);
    const i = await sheet({ title: esc(t('sort_title')), items: keys.map((k) => ({ icon: k === sortKey() ? 'check' : 'sort', label: t('sort_' + k) })) });
    if (i === null || keys[i] === sortKey()) return;
    haptic('select');
    updateSettings({ plSort: keys[i] });
    arrange(true);
  });

  root.querySelector('[data-create]').addEventListener('click', async () => {
    const name = await promptName({ title: t('lib_new_playlist'), action: t('create') });
    if (!name) return;
    const { id } = await api.createPlaylist(name);
    invalidatePlaylists();
    haptic('success');
    nav.push('playlist', { kind: 'user', id, title: name });
  });

  await load();
  root.onShow = () => {
    if (dirty) { dirty = false; load(); }
    root.querySelector('[data-go="likes"] .tile__sub').textContent = plural(likes.size);
  };
  return root;
}
