import { api } from '../api.js';
import { plural, t } from '../i18n.js';
import { getPlaylists, invalidatePlaylists, likes } from '../store.js';
import { esc, h, haptic, icon, promptName, thumb } from '../ui.js';

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
      <button class="tile tile--accent" data-go="likes">${icon('heartFill')}<span class="tile__title">${esc(t('lib_likes'))}</span><span class="tile__sub">${esc(plural(likes.size))}</span></button>
      <button class="tile tile--navy" data-go="history">${icon('clock')}<span class="tile__title">${esc(t('lib_history'))}</span><span class="tile__sub">&nbsp;</span></button>
    </div>
    <section class="section">
      <div class="section__head"><h2 class="section__title">${esc(t('lib_playlists'))}</h2>
        <button class="icon-btn icon-btn--accent" data-create aria-label="${esc(t('lib_new_playlist'))}">${icon('plus')}</button></div>
      <div class="playlists"><div class="skeleton">${'<div class="sk sk--row"></div>'.repeat(3)}</div></div>
    </section>
  </div>`);

  root.querySelector('[data-go="likes"]').addEventListener('click', () => nav.push('playlist', { kind: 'likes', title: t('lib_likes') }));
  root.querySelector('[data-go="history"]').addEventListener('click', () => nav.push('playlist', { kind: 'history', title: t('lib_history') }));

  const list = root.querySelector('.playlists');
  let dirty = false;
  document.addEventListener('playlists-changed', () => { dirty = true; });
  async function load() {
    const playlists = await getPlaylists();
    list.innerHTML = '';
    if (!playlists.length) {
      list.append(h(`<div class="empty empty--inline"><div class="empty__text">${esc(t('lib_empty_playlists'))}</div></div>`));
      return;
    }
    playlists.forEach((p) => {
      const row = h(`<button class="pl-row">${mosaic(p.covers)}
        <span class="pl-row__meta"><span class="pl-row__name">${esc(p.name)}</span><span class="pl-row__count">${esc(plural(p.count))}</span></span>
        ${icon('right', 'pl-row__chev')}</button>`);
      row.addEventListener('click', () => nav.push('playlist', { kind: 'user', id: p.id, title: p.name }));
      list.append(row);
    });
  }

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
