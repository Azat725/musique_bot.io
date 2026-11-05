const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const load = () => import('data:text/javascript,' + encodeURIComponent(fs.readFileSync(path.join(__dirname, '../../docs/js/tracklist.js'), 'utf8')));
const tr = (id, title, artist, duration) => ({ id, title, artist, duration });
const LIST = [tr('a', 'Zebra', 'Beta', 200), tr('b', 'alpha', 'Alpha', 100), tr('c', 'Ёлка', 'Beta', 300), tr('d', 'Delta 10', 'Gamma', 0), tr('e', 'Delta 2', 'Beta', 50)];
const ids = (list) => list.map((x) => x.id).join('');

test('default keeps the order, new and old follow how the list is kept, and the input is never changed', async () => {
  const { sortTracks } = await load();
  const before = ids(LIST);
  assert.equal(ids(sortTracks(LIST, 'default')), 'abcde');
  assert.equal(ids(sortTracks(LIST, 'nonsense')), 'abcde');
  assert.equal(ids(sortTracks(LIST, 'new', { newestFirst: true })), 'abcde', 'favourites already come newest first');
  assert.equal(ids(sortTracks(LIST, 'old', { newestFirst: true })), 'edcba');
  assert.equal(ids(sortTracks(LIST, 'new')), 'edcba', 'a playlist comes oldest first');
  assert.equal(ids(sortTracks(LIST, 'old')), 'abcde');
  assert.equal(ids(LIST), before);
});

test('by title and artist ignore case and ё, count numbers as numbers and break ties by title', async () => {
  const { sortTracks } = await load();
  assert.equal(ids(sortTracks(LIST, 'title')), 'cbeda', 'Cyrillic first (the app is Russian-first), then alpha, Delta 2, Delta 10, Zebra');
  assert.equal(ids(sortTracks(LIST, 'artist')), 'bcead', 'Alpha, then Beta by title (Ёлка, Delta 2, Zebra), then Gamma');
});

test('by length puts a track of unknown length with the shortest', async () => {
  const { sortTracks } = await load();
  assert.equal(ids(sortTracks(LIST, 'long')), 'cabed');
  assert.equal(ids(sortTracks(LIST, 'short')), 'debac');
});

test('artists come most frequent first (at most twelve) and the filter keeps one artist', async () => {
  const { artistsOf, byArtist } = await load();
  assert.deepEqual(artistsOf(LIST).map((a) => `${a.name}:${a.count}`), ['Beta:3', 'Alpha:1', 'Gamma:1']);
  assert.deepEqual(artistsOf([tr('x', 't', '', 1), tr('y', 't', '  ', 1)]), [], 'nobody to list');
  const many = Array.from({ length: 30 }, (_, i) => tr('t' + i, 't', 'Artist ' + i, 1));
  assert.equal(artistsOf(many).length, 12);
  assert.equal(ids(byArtist(LIST, 'Beta')), 'ace');
  assert.equal(byArtist(LIST, ''), LIST, 'no artist chosen: everything');
});
