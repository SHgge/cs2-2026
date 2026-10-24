// Tests for the Bo3 helpers of the referee page (docs/js/pages/ref.js; final 19 and 3rd place 20) — run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.document = globalThis.document || { addEventListener() {}, hidden: false };   // store.js touches document at import
const { _test: R } = await import('../docs/js/pages/ref.js');
const { vetoState, seriesState, mapPool } = await import('../docs/js/logic.js');

const KEYS = mapPool(null);   // ancient, anubis, cache, dust2, inferno, mirage, nuke
const ACTS = ['ban', 'ban', 'pick', 'pick', 'ban', 'ban'];
/** Bo3 veto after k steps; first = 'b' (coin): sides b, a, b, a, b, a. */
const bo3 = (k, extra = {}) => ({
  no: 19, stage: 'final', station: 'A', status: 'scheduled', best_of: 3, veto_first: 'b', veto_coin: true,
  veto: ['nuke', 'cache', 'inferno', 'mirage', 'ancient', 'anubis'].slice(0, k).map((map, i) => ({ side: i % 2 ? 'a' : 'b', map, act: ACTS[i] })),
  ...extra,
});

test('isBo3: best_of 3 only', () => {
  assert.equal(R.isBo3({ best_of: 3 }), true);
  assert.equal(R.isBo3({ best_of: '3' }), true);
  assert.equal(R.isBo3({ best_of: 1 }), false);
  assert.equal(R.isBo3({ no: 19, stage: 'final' }), false, 'old DB without best_of → Bo1');
  assert.equal(R.isBo3(null), false);
});

test('vetoAct / vetoBanArgs: picks at steps 2 and 3, bans elsewhere; Bo1 always ban', () => {
  const acts = [];
  for (let k = 0; k < 6; k++) acts.push(R.vetoAct(vetoState(bo3(k), KEYS)));
  assert.deepEqual(acts, ACTS);
  assert.equal(R.vetoAct(vetoState(bo3(6), KEYS)), 'ban', 'done → no next step');
  assert.equal(R.vetoAct(vetoState({ stage: 'qf', veto_first: 'a', veto: [] }, KEYS)), 'ban');
  assert.equal(R.vetoAct(null), 'ban');
  assert.deepEqual(R.vetoBanArgs(vetoState(bo3(2), KEYS), 'inferno'), { map: 'inferno', step: 2, side: 'b' }, 'the coin winner picks map 1');
  assert.deepEqual(R.vetoBanArgs(vetoState(bo3(3), KEYS), 'mirage'), { map: 'mirage', step: 3, side: 'a' }, 'the other team picks map 2');
});

test('vetoTiles Bo3: bans numbered 1–4, picks are games 1 and 2, the map left is the decider (never «play»)', () => {
  let tiles = R.vetoTiles(vetoState(bo3(4), KEYS), KEYS);
  const by = (k) => tiles.find((t) => t.key === k);
  assert.deepEqual(by('nuke').ban, { side: 'b', order: 1 });
  assert.deepEqual(by('cache').ban, { side: 'a', order: 2 });
  assert.deepEqual(by('inferno').pick, { side: 'b', game: 1 });
  assert.deepEqual(by('mirage').pick, { side: 'a', game: 2 });
  assert.equal(by('inferno').ban, null);
  assert.ok(tiles.every((t) => !t.decider && !t.play));
  tiles = R.vetoTiles(vetoState(bo3(6), KEYS), KEYS);
  assert.deepEqual(by('ancient').ban, { side: 'b', order: 3 });
  assert.deepEqual(by('anubis').ban, { side: 'a', order: 4 });
  assert.deepEqual(tiles.filter((t) => t.decider).map((t) => t.key), ['dust2']);
  assert.equal(tiles.some((t) => t.play), false);
  assert.equal(tiles.filter((t) => t.pick).length, 2);
  // Bo1 unchanged: last map is play, no pick/decider
  const b1 = R.vetoTiles(vetoState({ stage: 'group', veto: ['nuke', 'cache', 'ancient', 'anubis', 'dust2', 'inferno'].map((map, i) => ({ side: i % 2 ? 'b' : 'a', map })) }, KEYS), KEYS);
  assert.deepEqual(b1.filter((t) => t.play).map((t) => t.key), ['mirage']);
  assert.ok(b1.every((t) => !t.pick && !t.decider));
});

test('vetoAccess: a Bo3 with games entered is locked for referees (server: games_started); Bo1 unaffected', () => {
  const st = { station: 'A', chief: false };
  const chief = { station: null, chief: true };
  const live = bo3(6, { status: 'live', games: [{ a: 13, b: 9 }] });
  assert.deepEqual(R.vetoAccess(live, st), { can: false, chief: false, reason: 'games_started' });
  assert.deepEqual(R.vetoAccess(live, chief), { can: false, chief: true, reason: 'games_started' });
  assert.equal(R.vetoAccess({ ...live, games: [] }, st).can, true);
  assert.equal(R.vetoAccess({ station: 'A', status: 'live', games: [{ a: 1, b: 2 }] }, st).can, true, 'Bo1 ignores games');
});

test('vetoErrorText: Bo3 reasons and a stale step with its act', () => {
  assert.match(R.vetoErrorText({ ok: false, error: 'forbidden', reason: 'games_started' }), /оноо орсон/);
  assert.match(R.vetoErrorText({ ok: false, error: 'forbidden', reason: 'pool_small' }), /5 газрын зураг/);
  assert.match(R.vetoErrorText({ ok: false, error: 'stale', step: 2, act: 'pick' }), /Өөр төхөөрөмжөөс.*сонгоно/);
  assert.match(R.vetoErrorText({ ok: false, error: 'stale', step: 4, act: 'ban' }), /хасна/);
  assert.match(R.vetoErrorText({ ok: false, error: 'stale', step: 2 }), /Өөр төхөөрөмжөөс/);
  assert.match(R.vetoErrorText({ ok: false, error: 'validation', errors: [{ field: 'map', code: 'taken' }] }), /аль хэдийн хасагдсан эсвэл сонгогдсон/);
});

test('vetoFields carries the Bo3 maps list', () => {
  assert.deepEqual(R.vetoFields({ no: 19, veto: [], maps: ['inferno'], map: null, games: [] }), { veto: [], map: null, maps: ['inferno'] });
});

test('side choice: map 1 — the other team, map 2 — the coin winner; MatchZy team1 = team_a', () => {
  assert.equal(R.sideChooser('b', 1), 'a');
  assert.equal(R.sideChooser('b', 2), 'b');
  assert.equal(R.sideChooser('a', 1), 'b');
  assert.equal(R.sideChooser('a', 2), 'a');
  assert.equal(R.sideChooser('a', 3), null, 'decider = knife');
  assert.equal(R.sideChooser(null, 1), null);
  assert.equal(R.matchzySide('a', 'ct'), 'team1_ct');
  assert.equal(R.matchzySide('b', 't'), 'team2_t');
  assert.equal(R.matchzySide('b', null), null);
  assert.equal(R.matchzySide(null, 'ct'), null);
});

test('bo3JsonLines: num_maps, maplist in pick order + decider, map_sides from the choices, never guessed', () => {
  const maps = vetoState(bo3(6), KEYS).maps;
  assert.deepEqual(maps, ['inferno', 'mirage', 'dust2']);
  assert.deepEqual(R.bo3JsonLines(maps, 'b', {}), [
    '"num_maps": 3,',
    '"maplist": ["de_inferno", "de_mirage", "de_dust2"],',
    '"map_sides": ["<choose>", "<choose>", "knife"],',
    '"clinch_series": true,',
  ]);
  // map 1: team_a (other) chose CT → team1_ct; map 2: team_b (coin winner) chose T → team2_t
  assert.equal(R.bo3JsonLines(maps, 'b', { 1: 'ct', 2: 't' })[2], '"map_sides": ["team1_ct", "team2_t", "knife"],');
  assert.equal(R.bo3JsonLines(maps, 'a', { 1: 't' })[2], '"map_sides": ["team2_t", "<choose>", "knife"],');
  for (const line of R.bo3JsonLines(maps, 'b', { 1: 'ct', 2: 't' })) JSON.parse(`{${line.replace(/,$/, '')}}`);
  assert.equal(R.bo3JsonLines(['nuke'], 'a', {})[1], '"maplist": ["de_nuke", "<map>", "<map>"],');
});

test('checkSeries: each map a knockout score, nothing after 2 wins', () => {
  assert.deepEqual(R.checkSeries('final', []), { ok: true, bad: null, msg: '', wonA: 0, wonB: 0, decided: false, winner: null });
  let r = R.checkSeries('final', [{ a: 13, b: 9 }, { a: 13, b: 11 }]);
  assert.equal(r.ok, true); assert.equal(r.decided, true); assert.equal(r.winner, 'a'); assert.equal(r.wonA, 2);
  r = R.checkSeries('third', [{ a: 13, b: 9 }, { a: 9, b: 13 }, { a: 14, b: 16 }]);
  assert.equal(r.ok, true); assert.equal(r.winner, 'b'); assert.equal(r.wonB, 2);
  r = R.checkSeries('final', [{ a: 13, b: 9 }, { a: 13, b: 9 }, { a: 13, b: 1 }]);
  assert.equal(r.ok, false); assert.equal(r.bad, 3); assert.match(r.msg, /2-р газарт шийдэгдсэн/);
  assert.equal(R.checkSeries('final', [{ a: 12, b: 12 }]).bad, 1, 'no draws in a knockout map');
  assert.equal(R.checkSeries('final', [{ a: 13, b: 9 }, { a: 15, b: 13 }]).bad, 2);
  assert.equal(R.checkSeries('final', [{ a: 13, b: 12 }]).ok, false);
  assert.equal(R.checkSeries('final', [{ a: 1, b: 13 }, { a: 13, b: 1 }, { a: 13, b: 1 }, { a: 13, b: 1 }]).ok, false);
  assert.equal(R.checkSeries('final', [{ a: '13', b: 9 }]).ok, false);
});

test('setGame: append / replace; an earlier decision drops later maps', () => {
  assert.deepEqual(R.setGame([], 1, 13, 9), { games: [{ a: 13, b: 9 }], dropped: 0 });
  assert.deepEqual(R.setGame([{ a: 13, b: 9 }], 2, 9, 13), { games: [{ a: 13, b: 9 }, { a: 9, b: 13 }], dropped: 0 });
  assert.deepEqual(R.setGame([{ a: 13, b: 9 }, { a: 9, b: 13 }], 1, 11, 13), { games: [{ a: 11, b: 13 }, { a: 9, b: 13 }], dropped: 0 });
  // 2:1 → map 2 corrected to a win for A: the series ends 2:0 and map 3 is dropped
  assert.deepEqual(R.setGame([{ a: 13, b: 9 }, { a: 9, b: 13 }, { a: 13, b: 5 }], 2, 13, 7), { games: [{ a: 13, b: 9 }, { a: 13, b: 7 }], dropped: 1 });
  assert.equal(R.setGame([], 2, 13, 9), null, 'no skipping ahead');
  assert.equal(R.setGame([{ a: 13, b: 9 }, { a: 9, b: 13 }, { a: 13, b: 5 }], 4, 13, 0), null);
  assert.equal(R.setGame(null, 0, 13, 0), null);
  const src = [{ a: 13, b: 9, map: 'nuke' }];
  R.setGame(src, 1, 1, 13);
  assert.deepEqual(src, [{ a: 13, b: 9, map: 'nuke' }], 'input not mutated');
});

test('gameTabs / defaultGame: game 3 only at 1:1, no skipping, nothing after the decision', () => {
  const st = (games, extra = {}) => seriesState(bo3(6, { status: 'live', games, ...extra }), KEYS);
  let s = st([]);
  assert.deepEqual(R.gameTabs(s).map((t) => [t.n, t.map, t.enabled, t.played]), [[1, 'inferno', true, false], [2, 'mirage', false, false]]);
  assert.equal(R.defaultGame(s), 1);
  s = st([{ a: 13, b: 9 }]);
  assert.deepEqual(R.gameTabs(s).map((t) => [t.n, t.enabled, t.played, t.a, t.b]), [[1, true, true, 13, 9], [2, true, false, null, null]]);
  assert.equal(R.defaultGame(s), 2);
  s = st([{ a: 13, b: 9 }, { a: 9, b: 13 }]);
  assert.deepEqual(R.gameTabs(s).map((t) => [t.n, t.map, t.enabled]), [[1, 'inferno', true], [2, 'mirage', true], [3, 'dust2', true]]);
  assert.equal(R.defaultGame(s), 3);
  s = st([{ a: 13, b: 9 }, { a: 13, b: 11 }]);
  assert.equal(s.decided, true);
  assert.deepEqual(R.gameTabs(s).map((t) => t.n), [1, 2], '2:0 → no map 3');
  assert.equal(R.defaultGame(s), 2);
  s = st([{ a: 13, b: 9 }, { a: 9, b: 13 }, { a: 16, b: 14 }]);
  assert.deepEqual(R.gameTabs(s).map((t) => [t.n, t.enabled]), [[1, true], [2, true], [3, true]]);
  assert.equal(R.defaultGame(s), 3);
  // series forfeit: decided without games → only map 1 tab, disabled
  s = seriesState(bo3(6, { status: 'reported', forfeit: 'a', score_a: 0, score_b: 2 }), KEYS);
  assert.deepEqual(R.gameTabs(s).map((t) => t.enabled), [false, false]);
  assert.equal(R.defaultGame(s), 1);
  assert.deepEqual(R.gameTabs(null).map((t) => t.n), [1, 2]);
});

test('queue: one pending «games» list per match (the latest wins), payload validated', () => {
  const e = (id, no, action, extra = {}) => ({ id, no, action, a: null, b: null, forfeit: null, ...extra });
  assert.equal(R.validEntry(e('x', 19, 'games', { games: [{ a: 13, b: 9 }] })), true);
  assert.equal(R.validEntry(e('x', 19, 'games', { games: [] })), true, 'clearing the list is valid');
  assert.equal(R.validEntry(e('x', 19, 'games', {})), false);
  assert.equal(R.validEntry(e('x', 19, 'games', { games: [{ a: 13 }] })), false);
  assert.equal(R.validEntry(e('x', 19, 'games', { games: [{ a: 1, b: 13 }, { a: 1, b: 13 }, { a: 1, b: 13 }, { a: 1, b: 13 }] })), false);
  assert.equal(R.validEntry(e('x', 19, 'games', { games: [{ a: -1, b: 13 }] })), false);
  assert.equal(R.validEntry(e('x', 3, 'report', { a: 13, b: 4 })), true, 'Bo1 entries unchanged');
  let q = R.enqueueEntry([], e('1', 19, 'live'));
  q = R.enqueueEntry(q, e('2', 19, 'games', { games: [{ a: 13, b: 9 }] }));
  q = R.enqueueEntry(q, e('3', 20, 'games', { games: [{ a: 9, b: 13 }] }));
  q = R.enqueueEntry(q, e('4', 19, 'games', { games: [{ a: 13, b: 9 }, { a: 9, b: 13 }] }));
  assert.deepEqual(q.map((x) => x.id), ['1', '3', '4']);
  assert.deepEqual(q[2].games, [{ a: 13, b: 9 }, { a: 9, b: 13 }]);
});

test('applyQueue: pending Bo3 games show the series (live until decided, then reported 2:x); forfeit 2:0; Bo1 unchanged', () => {
  const base = bo3(6, { status: 'live', maps: ['inferno', 'mirage', 'dust2'], games: [], score_a: null, score_b: null });
  const q = (games) => [{ id: 'g', no: 19, action: 'games', games, a: null, b: null, forfeit: null }];
  let [m] = R.applyQueue([base], q([{ a: 13, b: 9 }]));
  assert.equal(m.status, 'live'); assert.equal(m.pending, 1);
  assert.deepEqual(m.games, [{ a: 13, b: 9, map: 'inferno' }]);
  assert.equal(m.score_a, null);
  [m] = R.applyQueue([base], q([{ a: 13, b: 9 }, { a: 9, b: 13 }, { a: 13, b: 11 }]));
  assert.equal(m.status, 'reported'); assert.equal(m.score_a, 2); assert.equal(m.score_b, 1);
  assert.deepEqual(m.games.map((g) => g.map), ['inferno', 'mirage', 'dust2']);
  [m] = R.applyQueue([{ ...base, status: 'reported', score_a: 2, score_b: 0, games: [{ a: 13, b: 1, map: 'inferno' }, { a: 13, b: 2, map: 'mirage' }] }], q([{ a: 13, b: 1 }]));
  assert.equal(m.status, 'live', 'a correction that un-decides the series goes back to live');
  assert.equal(m.score_a, null);
  [m] = R.applyQueue([base], [{ id: 'f', no: 19, action: 'report', a: null, b: null, forfeit: 'b' }]);
  assert.equal(m.status, 'reported'); assert.equal(m.score_a, 2); assert.equal(m.score_b, 0); assert.deepEqual(m.games, []);
  [m] = R.applyQueue([{ ...base, status: 'reported', score_a: 2, score_b: 1 }], [{ id: 'c', no: 19, action: 'final', a: null, b: null, forfeit: null }]);
  assert.equal(m.status, 'final'); assert.equal(m.score_a, 2); assert.equal(m.score_b, 1);
  const b1 = { no: 3, stage: 'group', status: 'live' };
  [m] = R.applyQueue([b1], [{ id: 'r', no: 3, action: 'report', a: 13, b: 4, forfeit: null }]);
  assert.deepEqual([m.status, m.score_a, m.score_b, m.forfeit, m.ot], ['reported', 13, 4, null, false]);
});

test('entryText: Bo1 lines as before; Bo3 games / forfeit / confirm lines', () => {
  assert.equal(R.entryText({ no: 3, action: 'live' }), '№3: эхэлсэн');
  assert.equal(R.entryText({ no: 3, action: 'report', a: 13, b: 4, forfeit: null }), '№3: 13 : 4');
  assert.equal(R.entryText({ no: 3, action: 'report', a: 0, b: 13, forfeit: 'a' }), '№3: 0 : 13 (техникийн)');
  assert.equal(R.entryText({ no: 3, action: 'final', a: 13, b: 4, forfeit: null }), '№3: 13 : 4 — эцсийн');
  assert.equal(R.entryText({ no: 19, action: 'games', games: [{ a: 13, b: 9 }, { a: 9, b: 13 }] }), '№19: газрууд 13:9 · 9:13');
  assert.equal(R.entryText({ no: 19, action: 'games', games: [] }), '№19: газрын оноог устгах');
  assert.equal(R.entryText({ no: 19, action: 'report', a: null, b: null, forfeit: 'a' }), '№19: техникийн ялагдал (цуврал 2 : 0)');
  assert.equal(R.entryText({ no: 19, action: 'final', a: null, b: null, forfeit: null }), '№19: цувралын дүн — эцсийн');
  assert.equal(R.gamesText([{ a: 16, b: 14 }]), '16:14');
});

test('referee slip keeps the pinned veto phrase and notes Bo3', () => {
  const src = readFileSync(new URL('../docs/js/print.js', import.meta.url), 'utf8');
  assert.ok(src.includes('Ахлагчид ээлжлэн тус бүр 3 газрын зураг хасна (финал, 3-р байр: Bo3).'));
  const ref = readFileSync(new URL('../docs/js/pages/ref.js', import.meta.url), 'utf8');
  assert.ok(ref.includes('10.24 07:00 – 10.25 20:00'), 'referee links valid until 20:00');
});
