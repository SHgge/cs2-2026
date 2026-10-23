// Map veto on the public pages (schedule card, #/tv, #/screen live card) — run: npm test
// Pure helpers from docs/js/pages/schedule.js (mergedMatches, vetoInfo) plus the schedule card rendered into a tiny
// fake DOM (ui.h needs only createElement / createTextNode / Node). Old states without the migration-13 fields must
// render exactly as before.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeState, match } from './fixtures.mjs';

// ---------- fake DOM (enough for ui.h and store.js at import time) ----------
class FakeNode {}
class FakeText extends FakeNode {
  constructor(t) { super(); this.data = String(t); }
  get textContent() { return this.data; }
}
class FakeEl extends FakeNode {
  constructor(tag) { super(); this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.className = ''; this.style = {}; this.dataset = {}; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener() {}
  appendChild(c) { this.children.push(c); return c; }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  /** All descendants (depth first) matching a class name. */
  all(cls) {
    const out = [];
    const walk = (el) => { for (const c of el.children) if (c instanceof FakeEl) { if (c.className.split(/\s+/).includes(cls)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  tags(tag) {
    const out = [];
    const walk = (el) => { for (const c of el.children) if (c instanceof FakeEl) { if (c.tagName === tag.toUpperCase()) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
}
globalThis.Node = FakeNode;
globalThis.document = {
  hidden: true, addEventListener() {}, createElement: (t) => new FakeEl(t), createTextNode: (t) => new FakeText(t),
};

let S;
before(async () => { S = await import('../docs/js/pages/schedule.js'); });

const KEYS = ['ancient', 'anubis', 'cache', 'dust2', 'inferno', 'mirage', 'nuke'];
/** Migration-13 fields on every match (veto not started) + settings.map_pool. */
function withVeto(state, pool = KEYS) {
  state.settings.map_pool = pool.slice();
  for (const m of state.matches) Object.assign(m, { veto_first: null, veto_coin: false, veto: [], map: null });
  return state;
}
function ban(state, no, maps, first = 'a', coin = false) {
  const m = match(state, no);
  m.veto = maps.map((map, i) => ({ side: i % 2 ? (first === 'a' ? 'b' : 'a') : first, map }));
  if (m.stage !== 'group' || coin) m.veto_first = first;
  m.veto_coin = coin;
  const left = (state.settings.map_pool || KEYS).filter((k) => !maps.includes(k));
  m.map = left.length === 1 ? left[0] : null;
  return state;
}
const row = (state, no) => S.mergedMatches(state).find((m) => m.no === no);
const SIX = ['nuke', 'cache', 'ancient', 'anubis', 'dust2', 'inferno'];

test('old state (no migration-13 fields): no veto keys on the merged matches, vetoInfo null, card unchanged', () => {
  const st = makeState();
  for (const m of S.mergedMatches(st)) {
    for (const k of ['veto_first', 'veto_coin', 'veto', 'map']) assert.ok(!(k in m), `#${m.no} ${k}`);
    assert.equal(S.vetoInfo(st, m), null);
  }
  const card = S.matchCard(st, row(st, 1), Date.parse('2026-10-24T10:00:00+08:00'));
  assert.equal(card.all('pm-veto').length, 0);
  assert.equal(S.vetoInfo(null, null), null);
});

test('mergedMatches passes the veto fields through; vetoInfo: group match, side a bans first', () => {
  const st = withVeto(makeState());
  let m = row(st, 1);
  assert.deepEqual([m.veto_first, m.veto_coin, m.veto, m.map], [null, false, [], null]);
  let v = S.vetoInfo(st, m);
  assert.deepEqual([v.started, v.done, v.map, v.first, v.next, v.total], [false, false, null, 'a', { side: 'a', step: 0 }, 6]);
  assert.deepEqual(v.pool, KEYS);
  ban(st, 1, SIX.slice(0, 3));
  v = S.vetoInfo(st, row(st, 1));
  assert.deepEqual([v.started, v.done, v.map, v.steps.length, v.next.side], [true, false, null, 3, 'b']);
  ban(st, 1, SIX);
  m = row(st, 1);
  v = S.vetoInfo(st, m);
  assert.deepEqual([v.done, v.map, m.map, v.next], [true, 'mirage', 'mirage', null]);
  assert.equal(S.mapName('dust2'), 'Dust II');
});

test('vetoInfo: knockout waits for the coin toss; pool from settings; m.map alone counts as decided; junk never throws', () => {
  const st = withVeto(makeState());
  let v = S.vetoInfo(st, row(st, 13));
  assert.deepEqual([v.needsFirst, v.next, v.started, v.done], [true, null, false, false]);
  ban(st, 13, [], 'b', true);
  v = S.vetoInfo(st, row(st, 13));
  assert.deepEqual([v.first, v.coin, v.next], ['b', true, { side: 'b', step: 0 }]);

  const small = withVeto(makeState(), ['nuke', 'mirage', 'inferno']);
  ban(small, 2, ['nuke', 'inferno']);
  v = S.vetoInfo(small, row(small, 2));
  assert.deepEqual([v.pool, v.total, v.done, v.map], [['nuke', 'mirage', 'inferno'], 2, true, 'mirage']);

  const odd = withVeto(makeState());
  match(odd, 3).map = 'anubis';                       // decided without the steps (should not happen) → still shown
  v = S.vetoInfo(odd, row(odd, 3));
  assert.deepEqual([v.done, v.map], [true, 'anubis']);
  match(odd, 4).map = 'overpass';                     // unknown key → not a decided map
  assert.equal(S.vetoInfo(odd, row(odd, 4)).map, null);
  match(odd, 5).veto = 'x';
  match(odd, 5).map = 5;
  assert.equal(S.vetoInfo(odd, row(odd, 5)), null);
  match(odd, 6).veto = [null, { side: 'c', map: 'nuke' }, { side: 'a', map: 'nuke' }, { side: 'b', map: 'nuke' }];
  assert.deepEqual(S.vetoInfo(odd, row(odd, 6)).steps, [{ side: 'a', map: 'nuke' }]);
});

test('schedule card: nothing before the first ban, struck bans while in progress, «Газрын зураг: Mirage» when decided', () => {
  const now = Date.parse('2026-10-24T09:50:00+08:00');
  const st = withVeto(makeState());
  assert.equal(S.matchCard(st, row(st, 1), now).all('pm-veto').length, 0, 'not started → no line');

  ban(st, 1, SIX.slice(0, 3));
  let card = S.matchCard(st, row(st, 1), now);
  let line = card.all('pm-veto');
  assert.equal(line.length, 1);
  assert.match(line[0].textContent, /Газрын зургийн хасалт 3\/6:/);
  assert.deepEqual(card.tags('s').map((e) => e.textContent), ['Nuke', 'Cache', 'Ancient']);
  assert.equal(card.all('pm-map').length, 0);
  // the banning team in the tooltip (A1 = «Багш нарын баг» bans first in the vector draw)
  assert.equal(card.tags('s')[0].getAttribute('title'), 'Багш нарын баг хассан');

  ban(st, 1, SIX);
  card = S.matchCard(st, row(st, 1), now);
  line = card.all('pm-veto');
  assert.equal(card.all('pm-map')[0].textContent, 'Газрын зураг: Mirage');
  assert.equal(card.tags('s').length, 6);
  assert.ok(!/\d\/6/.test(line[0].textContent), 'no counter once decided');
  assert.equal(S.matchCard(st, row(st, 1), now, { veto: false }).all('pm-veto').length, 0, '{veto:false} hides it');
});

test('display sources: shared vetoInfo, DOM built with h() only (no innerHTML), Mongolian copy', () => {
  const src = (f) => readFileSync(new URL(`../docs/js/pages/${f}`, import.meta.url), 'utf8');
  for (const f of ['schedule.js', 'tv.js', 'screen.js']) {
    const s = src(f);
    assert.match(s, /\bvetoInfo\(/, `${f} uses vetoInfo`);
    assert.doesNotMatch(s.replace(/^\s*\/\/.*$/gm, ''), /\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=/, `${f}: no HTML injection`);
  }
  const tv = src('tv.js');
  for (const phrase of ['Газрын зургийн хасалт', ' хасна (', 'Тоглох газрын зураг', 'Зоос хаяж, эхэлж хасах багийг тодруулна', "'veto'"]) {
    assert.ok(tv.includes(phrase), `tv.js: ${phrase}`);
  }
  assert.ok(src('screen.js').includes('Газрын зураг сонгож байна'));
});

test('#/tv: decided map stays one rotation step; hall board reloads on a new BUILD like #/screen (not the OBS overlay)', () => {
  const tv = readFileSync(new URL('../docs/js/pages/tv.js', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  // the pin ending (6th ban) holds the veto panel for ROTATE_MS instead of jumping to list[panel % n]
  assert.match(tv, /if \(wasPinned && !pinned\) holdUntil = now \+ ROTATE_MS;/);
  assert.match(tv, /pinned \|\| \(now < holdUntil && list\.includes\('veto'\)\) \? 'veto' : list\[panel % list\.length\]/);
  // BUILD check: same fetch / 30-minute sessionStorage guard as screen.js, hall board only, cleared on cleanup
  assert.match(tv, /import \{[^}]*\bBUILD\b[^}]*\} from '\.\.\/config\.js'/);
  assert.match(tv, /fetch\(`js\/config\.js\?b=\$\{Date\.now\(\)\}`, \{ cache: 'no-store' \}\)/);
  assert.match(tv, /sessionStorage\.getItem\('tv-reload'/);
  assert.match(tv, /Date\.now\(\) - prev\.at < 30 \* MIN\) return;/);
  assert.match(tv, /const tBuild = overlay \? null : setInterval\(checkBuild, BUILD_CHECK_MS\);/);
  assert.match(tv, /clearInterval\(tBuild\)/);
  assert.match(tv, /const BUILD_CHECK_MS = 10 \* MIN;/);
});
