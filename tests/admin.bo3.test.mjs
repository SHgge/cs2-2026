// Admin Bo3 helpers (matches 19, 20): series score from game rows, side choice, MatchZy series lines, veto summary.
// Pure functions, synthetic data only. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  seriesScore, seriesForfeitScore, gamesText, sideChooser, matchzySide, seriesJsonLines, SIDE_PLACEHOLDER, REF_VALID_TO,
} from '../docs/js/admin/util.js';
import { vetoSummary, vetoErrorText, seriesMapsText } from '../docs/js/admin/veto.js';
import { vetoState, mapPool } from '../docs/js/logic.js';

const POOL = mapPool(null);
const g = (a, b) => ({ a, b });
const E = { a: null, b: null };
/** Bo3 veto entries in order: [side, map, act] … (act from the standard sequence). */
const ACTS = ['ban', 'ban', 'pick', 'pick', 'ban', 'ban'];
const bo3Veto = (maps, first = 'a') => maps.map((map, i) => ({ side: i % 2 === 0 ? first : (first === 'a' ? 'b' : 'a'), map, act: ACTS[i] }));
const bo3 = (veto, extra = {}) => ({ no: 19, stage: 'final', best_of: 3, veto_first: 'a', veto, ...extra });

test('seriesScore: 2:0, 2:1, undecided, empty', () => {
  assert.deepEqual(seriesScore([]), { a: 0, b: 0, games: [], decided: false, winner: null, error: null });
  const s20 = seriesScore([g(13, 10), g(13, 8), E]);
  assert.deepEqual([s20.a, s20.b, s20.decided, s20.winner, s20.error], [2, 0, true, 'a', null]);
  assert.deepEqual(s20.games, [g(13, 10), g(13, 8)]);
  const s21 = seriesScore([g(13, 10), g(8, 13), g(14, 16)], 'third');
  assert.deepEqual([s21.a, s21.b, s21.decided, s21.winner], [1, 2, true, 'b']);
  const open = seriesScore([g(13, 5), E, E]);
  assert.deepEqual([open.a, open.b, open.decided, open.winner, open.error], [1, 0, false, null, null], 'trailing empty rows ignored');
  const oneAll = seriesScore([g(13, 5), g(5, 13), E]);
  assert.equal(oneAll.decided, false);
  assert.equal(oneAll.games.length, 2);
});

test('seriesScore: errors (incomplete, gap, invalid knockout score, game after the clinch)', () => {
  assert.deepEqual(seriesScore([{ a: 13, b: null }]).error, { code: 'incomplete', game: 1 });
  assert.deepEqual(seriesScore([E, g(13, 5)]).error, { code: 'gap', game: 2 });
  assert.deepEqual(seriesScore([g(12, 12)]).error, { code: 'invalid', game: 1 }, 'no draw in a knockout game');
  assert.deepEqual(seriesScore([g(13, 10), g(13, 12)]).error, { code: 'invalid', game: 2 });
  assert.deepEqual(seriesScore([g(13, 10), g(16, 15)]).error, { code: 'invalid', game: 2 });
  assert.equal(seriesScore([g(16, 14), g(19, 17)]).error, null, 'overtime scores are valid');
  assert.deepEqual(seriesScore([g(13, 10), g(13, 8), g(13, 5)]).error, { code: 'after_clinch', game: 3 });
  assert.deepEqual(seriesScore([g(13, 10), g(13, 8), g(13, 5)]).games, [g(13, 10), g(13, 8)], 'partial result kept');
  assert.deepEqual(seriesScore([{ a: -1, b: 13 }]).error, { code: 'incomplete', game: 1 }, 'negative = not a number');
  assert.deepEqual(seriesScore(null), { a: 0, b: 0, games: [], decided: false, winner: null, error: null });
});

test('seriesForfeitScore / gamesText', () => {
  assert.deepEqual(seriesForfeitScore('a'), { a: 0, b: 2 });
  assert.deepEqual(seriesForfeitScore('b'), { a: 2, b: 0 });
  assert.equal(seriesForfeitScore(null), null);
  assert.equal(seriesForfeitScore('x'), null);
  assert.equal(gamesText([g(13, 10), g(8, 13), g(13, 11)]), '13:10 · 8:13 · 13:11');
  assert.equal(gamesText(null), '');
});

test('sideChooser: game 1 — the other team, game 2 — the first team, decider — knife (null)', () => {
  assert.equal(sideChooser('a', 1), 'b');
  assert.equal(sideChooser('a', 2), 'a');
  assert.equal(sideChooser('a', 3), null);
  assert.equal(sideChooser('b', 1), 'a');
  assert.equal(sideChooser('b', 2), 'b');
  assert.equal(sideChooser(null, 1), null, 'no coin toss yet');
});

test('matchzySide: team1 = team_a, team2 = team_b', () => {
  assert.equal(matchzySide('a', 'ct'), 'team1_ct');
  assert.equal(matchzySide('a', 't'), 'team1_t');
  assert.equal(matchzySide('b', 'ct'), 'team2_ct');
  assert.equal(matchzySide('b', 't'), 'team2_t');
  assert.equal(matchzySide('b', ''), null);
  assert.equal(matchzySide(null, 'ct'), null);
});

test('seriesJsonLines: placeholders until both sides are chosen; valid JSON members once complete', () => {
  const ids = ['de_inferno', 'de_nuke', 'de_mirage'];
  const none = seriesJsonLines(ids, 'a', {});
  assert.equal(none.complete, false);
  assert.deepEqual(none.lines, [
    '"num_maps": 3,',
    '"maplist": ["de_inferno", "de_nuke", "de_mirage"],',
    `"map_sides": ["${SIDE_PLACEHOLDER}", "${SIDE_PLACEHOLDER}", "knife"],`,
    '"clinch_series": true,',
  ]);
  assert.equal(seriesJsonLines(ids, 'a', { 1: 'ct' }).complete, false, 'one side missing — never guessed');
  const full = seriesJsonLines(ids, 'a', { 1: 'ct', 2: 't' });
  assert.equal(full.complete, true);
  const obj = JSON.parse(`{${full.lines.join('\n').replace(/,\s*$/, '')}}`);
  assert.deepEqual(obj, { num_maps: 3, maplist: ids, map_sides: ['team2_ct', 'team1_t', 'knife'], clinch_series: true });
  const fb = seriesJsonLines(ids, 'b', { 1: 't', 2: 'ct' });
  assert.match(fb.lines[2], /"team1_t", "team2_ct", "knife"/, 'first = b: game 1 chooser a (team1), game 2 chooser b (team2)');
  assert.equal(seriesJsonLines(ids.slice(0, 2), 'a', { 1: 'ct', 2: 't' }).complete, false, 'needs 3 maps');
  assert.equal(seriesJsonLines(ids, null, { 1: 'ct', 2: 't' }).complete, false, 'no coin toss → no chooser');
});

test('vetoSummary Bo3: pick steps say «сонгоно», done shows the 3 maps in game order', () => {
  const nm = ['11б', '10б'];
  const start = vetoSummary(vetoState(bo3([]), POOL), ...nm);
  assert.deepEqual(start, { text: 'Эхлээгүй', detail: '11б эхэлж хасна', kind: '' });
  const two = vetoSummary(vetoState(bo3(bo3Veto(['nuke', 'cache'])), POOL), ...nm);
  assert.deepEqual(two, { text: 'Алхам 2/6 — 11б сонгоно', detail: '', kind: 'warn' });
  const three = vetoSummary(vetoState(bo3(bo3Veto(['nuke', 'cache', 'inferno'])), POOL), ...nm);
  assert.equal(three.text, 'Алхам 3/6 — 10б сонгоно');
  const four = vetoSummary(vetoState(bo3(bo3Veto(['nuke', 'cache', 'inferno', 'mirage'])), POOL), ...nm);
  assert.equal(four.text, 'Алхам 4/6 — 11б хасна');
  const done = vetoSummary(vetoState(bo3(bo3Veto(['nuke', 'cache', 'inferno', 'mirage', 'ancient', 'anubis'])), POOL), ...nm);
  assert.deepEqual(done, { text: 'Inferno → Mirage → Dust II', detail: 'Bo3', kind: 'ok' });
  const locked = vetoSummary(vetoState(bo3(bo3Veto(['nuke', 'cache']), { status: 'final' }), POOL), ...nm, { locked: true });
  assert.equal(locked.detail, 'алхам 2/6, дуусаагүй');
  const coin = vetoSummary(vetoState(bo3([], { veto_first: 'b', veto_coin: true }), POOL), ...nm);
  assert.equal(coin.detail, '10б эхэлж хасна (зоосоор)');
});

test('vetoSummary Bo1 unchanged next to Bo3 (best_of 1 or missing)', () => {
  const bans = (list) => list.map((map, i) => ({ side: i % 2 === 0 ? 'a' : 'b', map }));
  const mid = vetoSummary(vetoState({ stage: 'final', veto_first: 'a', veto: bans(['nuke', 'cache']) }, POOL), 'x', 'y');
  assert.equal(mid.text, 'Хасалт 2/6 — x хасна');
  const done = vetoSummary(vetoState({ stage: 'sf', best_of: 1, veto_first: 'a', veto: bans(['nuke', 'cache', 'ancient', 'anubis', 'inferno', 'mirage']) }, POOL), 'x', 'y');
  assert.deepEqual(done, { text: 'Dust II', detail: '', kind: 'ok' });
});

test('seriesMapsText', () => {
  assert.equal(seriesMapsText(['inferno', 'nuke', 'mirage']), 'Inferno → Nuke → Mirage');
  assert.equal(seriesMapsText(['dust2']), 'Dust II');
  assert.equal(seriesMapsText([]), '');
  assert.equal(seriesMapsText(null), '');
});

test('vetoErrorText: Bo3 reasons', () => {
  assert.match(vetoErrorText({ error: 'forbidden', reason: 'games_started' }), /газрын оноо орсон/);
  assert.match(vetoErrorText({ error: 'forbidden', reason: 'pool_small' }), /5 газрын зураг/);
  assert.match(vetoErrorText({ error: 'validation', errors: [{ field: 'map', code: 'taken' }] }), /сонгогдсон/);
});

test('referee links valid until 2026-10-25 20:00 (Bo3 final ends ≈17:15, awards 17:30)', () => {
  assert.equal(REF_VALID_TO, '2026-10-25T20:00:00+08:00');
});
