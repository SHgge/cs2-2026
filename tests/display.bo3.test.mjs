// Bo3 final (19) and 3rd-place match (20) on the public pages (schedule card, bracket, #/tv, #/screen) — run: npm test
// Pure helpers from docs/js/pages/schedule.js (mergedMatches, vetoInfo, seriesInfo, seriesText, liveSeriesScore) plus the
// schedule card and the bracket rendered into a tiny fake DOM, and source guards for tv.js / screen.js. Bo3 is state-driven
// (migration 14: best_of, maps, games); a state without those fields renders exactly as before (display.veto.test.mjs).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeState, match, playAllGroups, playKO, setSeries } from './fixtures.mjs';

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
  all(cls) {
    const out = [];
    const walk = (el) => { for (const c of el.children) if (c instanceof FakeEl) { if (c.className.split(/\s+/).includes(cls)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
}
globalThis.Node = FakeNode;
globalThis.document = {
  hidden: true, addEventListener() {}, createElement: (t) => new FakeEl(t), createTextNode: (t) => new FakeText(t),
};

let S;
let B;
let EV;
before(async () => {
  S = await import('../docs/js/pages/schedule.js');
  B = await import('../docs/js/pages/bracket.js');
  EV = await import('../docs/js/event.js');
});

const KEYS = ['ancient', 'anubis', 'cache', 'dust2', 'inferno', 'mirage', 'nuke'];
const ACTS = ['ban', 'ban', 'pick', 'pick', 'ban', 'ban'];
/** Migration-13/14 fields on every match + settings.map_pool; 19, 20 Bo3. */
function withBo3(state) {
  state.settings.map_pool = KEYS.slice();
  for (const m of state.matches) Object.assign(m, { veto_first: null, veto_coin: false, veto: [], map: null, best_of: 1, maps: null, games: [] });
  for (const no of [19, 20]) Object.assign(match(state, no), { best_of: 3, maps: [] });
  return state;
}
/** Bo3 veto steps (ban, ban, pick, pick, ban, ban) from the coin-toss side `first`; maps as the server stores them. */
function veto3(state, no, maps, first = 'b') {
  const m = match(state, no);
  const other = first === 'a' ? 'b' : 'a';
  m.veto_first = first;
  m.veto_coin = true;
  m.veto = maps.map((map, i) => ({ side: i % 2 ? other : first, map, act: ACTS[i] }));
  const picks = m.veto.filter((x) => x.act === 'pick').map((x) => x.map);
  const left = KEYS.filter((k) => !maps.includes(k));
  m.maps = [...picks, ...(left.length === 1 ? left : [])];
  m.map = null;
  return m;
}
const SIX = ['nuke', 'cache', 'inferno', 'dust2', 'ancient', 'anubis'];   // picks: inferno (b), dust2 (a); decider mirage
/** Groups + QF + SF played, so 19 and 20 have known teams. */
const dayTwo = () => withBo3(playKO(playAllGroups(makeState()), { 13: 'a', 14: 'a', 15: 'a', 16: 'a', 17: 'a', 18: 'b' }));
const row = (state, no) => S.mergedMatches(state).find((m) => m.no === no);
const LIVE_AT = Date.parse('2026-10-25T15:40:00+08:00');

test('schedule data: 19/20 at 14:30–17:15, ceremony 17:30, links valid until 20:00', () => {
  const at = (no) => EV.MATCHES.find((m) => m.no === no);
  for (const no of [19, 20]) assert.deepEqual([at(no).start, at(no).end], ['2026-10-25T14:30:00+08:00', '2026-10-25T17:15:00+08:00']);
  assert.ok(!('best_of' in at(19)), 'event.js stays format-free (state-driven Bo3)');
  assert.deepEqual(EV.DAY_INFO.d2.map(([t]) => t), ['08:30', '08:45', '12:00', '14:15', '17:30']);
  assert.equal(EV.DAY_INFO.d2[3][1], 'Завсарлага (14:30 хүртэл)');
  assert.equal(EV.DAY_INFO.d2[4][1], 'Шагнал гардуулах, шилжин явах цом');
  assert.equal(EV.DATES.links_expire_at, '2026-10-25T20:00:00+08:00');
  assert.match(S.DAYS[1].sub, /Финал, 3-р байр Bo3$/);
});

test('mergedMatches passes best_of / maps / games; old states get none of them', () => {
  const st = dayTwo();
  setSeries(st, 19, [[13, 9]], { maps: ['inferno', 'dust2', 'mirage'] });
  const m = row(st, 19);
  assert.deepEqual([m.best_of, m.maps, m.games], [3, ['inferno', 'dust2', 'mirage'], [{ a: 13, b: 9 }]]);
  assert.equal(row(st, 13).best_of, 1);
  for (const k of ['best_of', 'maps', 'games']) assert.ok(!(k in row(makeState(), 19)), k);
  assert.equal(S.isBo3(row(makeState(), 19)), false);
  assert.equal(S.seriesInfo(makeState(), row(makeState(), 19)), null);
  assert.equal(S.isBo3(row(st, 19)), true);
  assert.equal(S.isBo3(null), false);
});

test('vetoInfo (Bo3): ban, ban, pick, pick, ban, ban → three maps in play order, map stays null', () => {
  const st = dayTwo();
  veto3(st, 19, SIX.slice(0, 3));
  let v = S.vetoInfo(st, row(st, 19));
  assert.deepEqual([v.bo, v.started, v.done, v.map, v.nextAct, v.next], [3, true, false, null, 'pick', { side: 'a', step: 3 }]);
  assert.deepEqual(v.maps, ['inferno']);
  veto3(st, 19, SIX);
  v = S.vetoInfo(st, row(st, 19));
  assert.deepEqual([v.done, v.map, v.maps, v.nextAct], [true, null, ['inferno', 'dust2', 'mirage'], null]);
  // the server's maps win when the veto list is behind (e.g. an admin override)
  const m = match(st, 20);
  Object.assign(m, { veto: [], maps: ['nuke', 'mirage', 'anubis'], veto_first: 'a' });
  v = S.vetoInfo(st, row(st, 20));
  assert.deepEqual([v.maps, v.done], [['nuke', 'mirage', 'anubis'], true]);
});

test('seriesInfo / seriesText / liveSeriesScore: live 1:0, decided 2:0 and 2:1, held decider, forfeit', () => {
  const st = dayTwo();
  veto3(st, 19, SIX);
  setSeries(st, 19, [[13, 9]], { maps: ['inferno', 'dust2', 'mirage'] });
  let m = row(st, 19);
  let si = S.seriesInfo(st, m);
  assert.deepEqual([si.wonA, si.wonB, si.decided, si.played, si.current, si.currentMap], [1, 0, false, 1, 1, 'dust2']);
  assert.equal(S.seriesText(si), 'Inferno 13:9 · Dust II – · Mirage –');
  assert.equal(S.liveSeriesScore(m, si), '1 : 0');

  setSeries(st, 19, [[13, 9], [16, 14]], { maps: ['inferno', 'dust2', 'mirage'] });   // 2:0 → the decider is not shown
  m = row(st, 19);
  si = S.seriesInfo(st, m);
  assert.deepEqual([si.decided, si.winner, si.rows.length, si.current], [true, 'a', 2, null]);
  assert.equal(S.seriesText(si), 'Inferno 13:9 · Dust II 16:14');
  assert.equal(S.liveSeriesScore(m, si), '');
  assert.equal(S.scoreText(m), '2 : 0');

  setSeries(st, 19, [[13, 9], [8, 13], [13, 11]], { maps: ['inferno', 'dust2', 'mirage'] });
  si = S.seriesInfo(st, row(st, 19));
  assert.equal(S.seriesText(si), 'Inferno 13:9 · Dust II 8:13 · Mirage 13:11');
  assert.equal(S.winnerSide(row(st, 19)), 'a');

  // public view: the deciding game is still inside the 120 s hold, the series score is already out → 3rd map «–»
  const held = match(st, 19);
  Object.assign(held, { games: [{ a: 13, b: 9 }, { a: 8, b: 13 }], score_a: 2, score_b: 1, status: 'final' });
  si = S.seriesInfo(st, row(st, 19));
  assert.deepEqual([si.decided, si.rows.length], [true, 3]);
  assert.equal(S.seriesText(si), 'Inferno 13:9 · Dust II 8:13 · Mirage –');

  setSeries(st, 20, [], { forfeit: 'b', maps: ['nuke', 'mirage', 'anubis'] });
  si = S.seriesInfo(st, row(st, 20));
  assert.deepEqual([si.decided, si.rows, si.wonA, si.wonB], [true, [], 2, 0]);
  assert.equal(S.scoreText(row(st, 20)), '2 : 0 (техникийн)');
  assert.equal(S.seriesText(null), '');
  assert.equal(S.liveSeriesScore(row(st, 13), S.seriesInfo(st, row(st, 13))), '', 'Bo1 → no live series score');
});

test('schedule card: «Финал · Bo3», live series score, per-map line with the current map, then the final score', () => {
  const st = dayTwo();
  let card = S.matchCard(st, row(st, 19), LIVE_AT);
  assert.equal(card.all('pub-ko')[0].textContent, 'Финал · Bo3');
  assert.equal(card.all('pm-veto').length, 0, 'no veto yet → no line');

  veto3(st, 19, SIX.slice(0, 4));
  card = S.matchCard(st, row(st, 19), LIVE_AT);
  assert.match(card.all('pm-veto')[0].textContent, /^Газрын зургийн хасалт, сонголт 4\/6:/);
  assert.deepEqual(card.all('pm-pick').map((e) => e.textContent), ['1. Inferno', '2. Dust II']);

  veto3(st, 19, SIX);
  setSeries(st, 19, [[13, 9]], { maps: ['inferno', 'dust2', 'mirage'] });
  card = S.matchCard(st, row(st, 19), LIVE_AT);
  const sc = card.all('pm-score')[0];
  assert.deepEqual([sc.textContent, sc.className], ['1 : 0', 'pm-score live']);
  assert.deepEqual(card.all('pm-g').map((e) => e.textContent), ['Inferno 13:9', 'Dust II –', 'Mirage –']);
  assert.deepEqual(card.all('cur').map((e) => e.textContent), ['Dust II –'], 'the map being played is marked');
  assert.equal(card.all('pm-g')[0].getAttribute('title'), '1-р газар: 11а сонгосон');
  assert.equal(card.all('pm-g')[2].getAttribute('title'), '3-р газар: шийдвэрлэх');
  assert.equal(card.all('pm-bans')[0].children.filter((c) => c.tagName === 'S').length, 4, 'four bans, struck');

  setSeries(st, 19, [[13, 9], [8, 13], [13, 11]], { maps: ['inferno', 'dust2', 'mirage'] });
  card = S.matchCard(st, row(st, 19), Date.parse('2026-10-25T17:20:00+08:00'));
  assert.deepEqual([card.all('pm-score')[0].textContent, card.all('pm-score')[0].className], ['2 : 1', 'pm-score']);
  assert.equal(card.all('cur').length, 0);
  assert.equal(card.all('pm-maps')[0].textContent, 'Inferno 13:9Dust II 8:13Mirage 13:11');
});

test('bracket: «Bo3 · 13:9, 8:13, 13:11» under the final, map names before the first game, header «14:30 · Bo3»', () => {
  const st = dayTwo();
  const foot = (state, no) => {
    const box = B.bracketTree(state, { now: LIVE_AT }).all(`bks-${no === 19 ? 'final' : 'third'}`)[0];
    const f = box.all('bk-foot')[0];
    return f ? f.textContent : null;
  };
  assert.equal(foot(st, 19), 'Bo3');
  veto3(st, 19, SIX);
  assert.equal(foot(st, 19), 'Bo3 · Inferno, Dust II, Mirage');
  setSeries(st, 19, [[13, 9], [8, 13], [13, 11]], { maps: ['inferno', 'dust2', 'mirage'] });
  assert.equal(foot(st, 19), 'Bo3 · 13:9, 8:13, 13:11');
  setSeries(st, 20, [], { forfeit: 'a' });
  assert.equal(foot(st, 20), 'Техникийн ялалт');
  const h3 = B.bracketTree(st, { now: LIVE_AT }).all('bk-h3')[0];
  assert.equal(h3.textContent, 'Финал, 3-р байр14:30 · Bo3');
  // Bo1 state (no migration 14): old foot rules
  const old = playKO(playAllGroups(makeState()), { 13: 'a', 14: 'a', 15: 'a', 16: 'a', 17: 'a', 18: 'b', 19: 'a', 20: 'b' });
  assert.equal(foot(old, 19), null);
});

test('display sources: Bo3 copy in tv.js / screen.js / home / class, built with h() only', () => {
  const src = (f) => readFileSync(new URL(`../docs/${f}`, import.meta.url), 'utf8');
  const tv = src('js/pages/tv.js');
  for (const phrase of [' сонгоно (', ' хасна (', '3 · Шийдвэрлэх', 'Газрын зургийн хасалт, сонголт ', '-р газар`', 'function bo3Board(', 'liveSeriesScore(']) {
    assert.ok(tv.includes(phrase), `tv.js: ${phrase}`);
  }
  const scr = src('js/pages/screen.js');
  for (const phrase of ["'Финал · Bo3'", "'3-р байр · Bo3'", "['10.25 (Ня)', '14:30', 'Финал · Bo3']", "['10.25 (Ня)', '17:30', 'Шагнал']",
    "['12:00', '17:30']", 'Финал, 3-р байр 14:30-д, Bo3. Шагнал гардуулах ёслол 17:30-д', 'liveSeriesScore(m, si)']) {
    assert.ok(scr.includes(phrase), `screen.js: ${phrase}`);
  }
  for (const f of ['js/pages/screen.js', 'js/pages/tv.js', 'js/pages/home.js', 'js/pages/bracket.js']) {
    assert.ok(!/14:45|16:15/.test(src(f).replace(/^\s*\/\/.*$/gm, '')), `${f}: no old day-2 times`);
  }
  assert.match(src('js/pages/home.js'), /14:30 финал, 3-р байр \(Bo3\) · 17:30 шагнал/);
  assert.match(src('js/pages/class.js'), /10\.25-ны 20:00 хүртэл/);
  assert.match(src('content/home.html'), /Финал, 3-р байр Bo3/);
  for (const f of ['js/pages/schedule.js', 'js/pages/tv.js', 'js/pages/screen.js', 'js/pages/bracket.js']) {
    assert.doesNotMatch(src(f).replace(/^\s*\/\/.*$/gm, ''), /\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=/, `${f}: no HTML injection`);
  }
});
