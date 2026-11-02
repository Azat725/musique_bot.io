import { api } from '../api.js';
import { viewScope } from '../lifecycle.js';
import { radioProfile, radioTracks } from '../radio.js';
import { t } from '../i18n.js';
import { player } from '../player.js';
import { onSettings, phonoMode, radioMode, settings } from '../store.js';
import { brandMark, cover, esc, h, haptic, icon, loader, openArtist, toast } from '../ui.js';

/** "Good morning", or "Good morning, Azat" when a name is set in Settings. */
function greeting() {
  const hr = new Date().getHours();
  const hello = t(hr < 5 ? 'greet_night' : hr < 12 ? 'greet_morning' : hr < 18 ? 'greet_day' : hr < 23 ? 'greet_evening' : 'greet_night');
  const name = (settings.name || '').trim().slice(0, 24);
  return name ? `${hello}, ${name}` : hello;
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

export async function render(_, nav) {
  const root = h(`<div class="view">
    <header class="hero">
      <div class="brand">${brandMark()}<span class="brand__name">Musique</span></div>
      <h1 class="hero__title">${esc(greeting())}</h1>
    </header>
    <div class="home__body"></div>
  </div>`);
  const body = root.querySelector('.home__body');
  const title = root.querySelector('.hero__title');
  const scope = viewScope(root);
  scope.keep(onSettings(() => { if (title.textContent !== greeting()) title.textContent = greeting(); }));
  body.append(h(loader()));

  let data; try { data = await api.home(); } catch(error) { root.dispose(); throw error; }
  body.innerHTML = '';
  const openList = (title, tracks) => () => nav.push('playlist', { kind: 'tracks', title, tracks });

  // the phonograph's own shelf: what it can play
  if (phonoMode()) {
    const shelf = h('<section class="section shelf--phono"></section>');
    body.append(shelf);
    api.phonograph().then(({ tracks }) => {
      if (!tracks?.length) return;
      const all = h(`<button class="btn btn--accent shelf__play">${icon('play')}<span>${esc(t('phono_play_all'))}</span></button>`);
      all.addEventListener('click', () => { haptic('light'); player.playQueue(tracks, 0, { shuffle: true }); });
      const sub = h(`<p class="shelf__sub">${esc(t('phono_count', { n: tracks.length }))}</p>`);
      shelf.append(sectionHead(t('phono_shelf'), openList(t('phono_shelf'), tracks)), sub, all, cards(tracks));
    }).catch(() => {});
  }

  if (radioMode()) {
    const section = h(`<section class="section"><div class="section__head"><h2 class="section__title">${esc(t('radio_shelf'))}</h2></div>
      <p class="shelf__sub" data-radio-selection></p><p class="shelf__sub">${esc(t('radio_recording_note'))}</p><button class="btn btn--accent" data-radio-play>${icon('radio')}<span>${esc(t('radio_start'))}</span></button><button class="link" data-radio-settings>${esc(t('nav_settings'))}</button><p role="status" data-radio-status></p></section>`);
    const button = section.querySelector('[data-radio-play]');
    const selection=()=>{section.querySelector('[data-radio-selection]').textContent=t('radio_ready',{model:radioProfile().name,country:t('radio_'+settings.radioCountry),decade:settings.radioDecade})+' · '+t('radio_source_'+settings.radioSource);};
    selection(); scope.keep(onSettings(selection));
    section.querySelector('[data-radio-settings]').addEventListener('click',()=>nav.push('settings',{section:'device'}));
    button.addEventListener('click', async () => {
      haptic('light'); button.disabled = true;
      const fingerprint=JSON.stringify([settings.playerMode,settings.radioSource,settings.radioCountry,settings.radioDecade]);
      const status=section.querySelector('[data-radio-status]'); status.textContent=t('radio_loading');
      try {
        const tracks = await radioTracks();
        if(fingerprint!==JSON.stringify([settings.playerMode,settings.radioSource,settings.radioCountry,settings.radioDecade]) || root.disposed) return;
        if (tracks.length && radioMode()) { player.playQueue(tracks, 0); status.textContent=''; }
        else status.textContent=t('radio_no_match');
      } catch { status.textContent=t('radio_no_match'); } finally { button.disabled = false; }
    });
    body.append(section);
  }

  if (data.recent?.length) {
    const s = h('<section class="section"></section>');
    s.append(sectionHead(t('home_recent'), openList(t('home_recent'), data.recent)), cards(data.recent));
    body.append(s);
  }

  // 'For you' comes in its own request so the page never waits for it
  const forYou = h(`<section class="section section--later">${loader()}</section>`);
  body.append(forYou);
  async function loadRecommendations() {
    forYou.setAttribute('aria-busy','true');
    try {
      const {tracks}=await api.recommend(); if(root.disposed)return;
      forYou.replaceChildren();
      if(tracks?.length) forYou.append(sectionHead(t('home_for_you'),openList(t('home_for_you'),tracks)),cards(tracks.slice(0,15)));
      else forYou.append(h(`<p class="empty__text">${esc(t('home_empty_text'))}</p>`));
    } catch {
      if(root.disposed)return;
      const retry=h(`<button class="btn btn--outline">${esc(t('retry'))}</button>`);
      retry.addEventListener('click',()=>{retry.disabled=true;loadRecommendations();});
      forYou.replaceChildren(h(`<p class="empty__text">${esc(t('search_failed'))}</p>`),retry);
    } finally {forYou.removeAttribute('aria-busy');}
  }
  loadRecommendations();

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

  if (!body.children.length || [...body.children].every((c) => c.hidden)) {
    // nothing came back: say so instead of leaving an empty page
    const empty = h(`<div class="empty">${icon('vinyl', 'empty__icon')}
      <div class="empty__title">${esc(t('home_empty'))}</div><div class="empty__text">${esc(t('home_empty_text'))}</div>
      <button class="btn btn--accent">${esc(t('nav_search'))}</button></div>`);
    empty.querySelector('button').addEventListener('click', () => document.querySelector('[data-tab="search"]')?.click());
    body.append(empty);
  }
  return root;
}
