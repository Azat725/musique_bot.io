import { api } from '../api.js';
import { t } from '../i18n.js';
import { player } from '../player.js';
import { brandMark, cover, esc, h, haptic, icon, openArtist, trackList } from '../ui.js';

function greeting() {
  const hr = new Date().getHours();
  return t(hr < 5 ? 'greet_night' : hr < 12 ? 'greet_morning' : hr < 18 ? 'greet_day' : hr < 23 ? 'greet_evening' : 'greet_night');
}

function cards(tracks) {
  const row = h('<div class="cards"></div>');
  tracks.forEach((tr, i) => {
    const card = h(`<button class="card">
      ${cover(tr.cover, 'card__cover', 400)}
      <span class="card__title">${esc(tr.title)}</span>
      <span class="card__artist">${esc(tr.artist)}</span>
    </button>`);
    card.addEventListener('click', (e) => {
      if (e.target.closest('.card__artist')) { openArtist(tr); return; }
      haptic('light');
      player.playQueue(tracks, i);
    });
    row.append(card);
  });
  return row;
}

function sectionHead(title, onAll) {
  const head = h(`<div class="section__head"><h2 class="section__title">${esc(title)}</h2></div>`);
  if (onAll) {
    const btn = h(`<button class="link">${esc(t('see_all'))}${icon('right')}</button>`);
    btn.addEventListener('click', onAll);
    head.append(btn);
  }
  return head;
}

function skeleton() {
  return h(`<div class="skeleton">
    <div class="sk sk--title"></div>
    <div class="cards">${'<div class="card"><div class="sk sk--cover"></div><div class="sk sk--line"></div></div>'.repeat(3)}</div>
    <div class="sk sk--title"></div>
    ${'<div class="sk sk--row"></div>'.repeat(5)}
  </div>`);
}

export async function render(_, nav) {
  const root = h(`<div class="view">
    <header class="hero">
      <div class="brand">${brandMark()}<span class="brand__name">Musique</span></div>
      <h1 class="hero__title">${esc(greeting())}</h1>
    </header>
    <div class="home__body"></div>
  </div>`);
  const body = root.querySelector('.home__body');
  body.append(skeleton());

  const data = await api.home();
  body.innerHTML = '';
  const openList = (title, tracks) => () => nav.push('playlist', { kind: 'tracks', title, tracks });

  if (data.recent?.length) {
    const s = h('<section class="section"></section>');
    s.append(sectionHead(t('home_recent'), openList(t('home_recent'), data.recent)), cards(data.recent));
    body.append(s);
  }

  const byKey = Object.fromEntries((data.sections || []).map((s) => [s.key, s.tracks]));
  if (byKey.trending?.length) {
    const s = h('<section class="section"></section>');
    s.append(sectionHead(t('home_trending'), openList(t('home_trending'), byKey.trending)),
      trackList(byKey.trending.slice(0, 5), { numbered: true }));
    body.append(s);
  }

  if (data.genres?.length) {
    const s = h('<section class="section"></section>');
    s.append(sectionHead(t('home_genres')));
    const grid = h('<div class="genres"></div>');
    data.genres.forEach((g, i) => {
      const title = t('genre_' + g.key);
      const tile = h(`<button class="genre genre--${i % 3}"><span>${esc(title)}</span></button>`);
      tile.addEventListener('click', () => nav.push('playlist', { kind: 'yt', id: g.id, title }));
      grid.append(tile);
    });
    s.append(grid);
    body.append(s);
  }

  for (const [key, label] of [['top_ru', 'home_top_ru'], ['top_global', 'home_top_global']]) {
    if (!byKey[key]?.length) continue;
    const s = h('<section class="section"></section>');
    s.append(sectionHead(t(label), openList(t(label), byKey[key])), cards(byKey[key].slice(0, 15)));
    body.append(s);
  }
  return root;
}
