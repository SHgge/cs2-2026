// Tests for the Bo3 helpers in docs/js/logic.js (final 19 and 3rd-place match 20, user 2026-10-24) — run: npm test
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../docs/js/logic.js';
import { makeState, match, playAllGroups, playKO, setSeries } from './fixtures.mjs';

const KEYS = ['ancient', 'anubis', 'cache', 'dust2', 'inferno', 'mirage', 'nuke'];
const T = 4; // «Багш нарын баг»
// first (a) bans nuke, b bans cache, a picks mirage, b picks inferno, a bans ancient, b bans anubis → decider dust2
const FULL = [
  { side: 'a', map: 'nuke', act: 'ban' }, { side: 'b', map: 'cache', act: 'ban' },
  { side: 'a', map: 'mirage', act: 'pick' }, { side: 'b', map: 'inferno', act: 'pick' },
  { side: 'a', map: 'ancient', act: 'ban' }, { side: 'b', map: 'anubis', act: 'ban' },
];
const bo3 = (extra = {}) => ({ no: 19, stage: 'final', best_of: 3, veto_first: 'a', veto: FULL, ...extra });

describe('bestOf / vetoSequence', () => {
  test('bestOf: 3 only when the state says best_of 3', () => {
    assert.equal(L.bestOf({ best_of: 3 }), 3);
    assert.equal(L.bestOf({ best_of: '3' }), 3);
    for (const m of [{ best_of: 1 }, { best_of: 5 }, { best_of: null }, {}, null, undefined, 'x']) assert.equal(L.bestOf(m), 1);
  });

  test('vetoSequence: Bo1 all bans; Bo3 ban, ban, pick, pick, ban, ban (7 maps), picks at steps 2–3 for other pools', () => {
    assert.deepEqual(L.vetoSequence({ stage: 'qf' }, KEYS), Array(6).fill('ban'));
    assert.deepEqual(L.vetoSequence({ best_of: 3 }, KEYS), ['ban', 'ban', 'pick', 'pick', 'ban', 'ban']);
    assert.deepEqual(L.vetoSequence({ best_of: 3 }), ['ban', 'ban', 'pick', 'pick', 'ban', 'ban']); // default pool = MAPS
    assert.deepEqual(L.vetoSequence({ best_of: 3 }, KEYS.slice(0, 5)), ['ban', 'ban', 'pick', 'pick']);
    assert.deepEqual(L.vetoSequence(null, ['nuke', 'mirage', 'dust2']), ['ban', 'ban']);
  });
});

describe('vetoState: Bo3', () => {
  test('step by step: sides alternate as in Bo1, acts follow the sequence, maps fill in pick order + decider', () => {
    const want = [
      [{ side: 'a', step: 0 }, 'ban'], [{ side: 'b', step: 1 }, 'ban'], [{ side: 'a', step: 2 }, 'pick'],
      [{ side: 'b', step: 3 }, 'pick'], [{ side: 'a', step: 4 }, 'ban'], [{ side: 'b', step: 5 }, 'ban'],
    ];
    for (let n = 0; n < 6; n++) {
      const v = L.vetoState(bo3({ veto: FULL.slice(0, n) }), KEYS);
      assert.deepEqual(v.next, want[n][0], `next after ${n}`);
      assert.equal(v.nextAct, want[n][1], `nextAct after ${n}`);
      assert.equal(v.bo, 3);
      assert.equal(v.done, false);
      assert.equal(v.map, null);
    }
    const two = L.vetoState(bo3({ veto: FULL.slice(0, 3) }), KEYS);
    assert.deepEqual(two.picks, ['mirage']);
    assert.deepEqual(two.maps, ['mirage']);
    assert.deepEqual(two.banned, ['nuke', 'cache']);
    const v = L.vetoState(bo3(), KEYS);
    assert.equal(v.done, true);
    assert.equal(v.next, null);
    assert.equal(v.nextAct, null);
    assert.equal(v.map, null, 'Bo3: no single map');
    assert.deepEqual(v.picks, ['mirage', 'inferno']);
    assert.deepEqual(v.maps, ['mirage', 'inferno', 'dust2']);
    assert.deepEqual(v.banned, ['nuke', 'cache', 'ancient', 'anubis']);
    assert.deepEqual(v.remaining, ['dust2']);
    assert.deepEqual(v.acts, ['ban', 'ban', 'pick', 'pick', 'ban', 'ban']);
    assert.deepEqual(v.steps, FULL.map(({ side, map }) => ({ side, map })), 'steps keep the {side, map} shape');
  });

  test('coin toss first b → b bans first and picks map 1', () => {
    const veto = [{ side: 'b', map: 'nuke', act: 'ban' }, { side: 'a', map: 'cache', act: 'ban' }, { side: 'b', map: 'nuke', act: 'pick' }];
    const v = L.vetoState({ stage: 'final', best_of: 3, veto_first: 'b', veto_coin: true, veto }, KEYS);
    assert.equal(v.coin, true);
    assert.deepEqual(v.next, { side: 'b', step: 2 }); // the duplicate nuke is skipped like any invalid entry
    assert.equal(v.nextAct, 'pick');
  });

  test('knockout Bo3 before the coin toss: needsFirst, no next, no nextAct', () => {
    const v = L.vetoState({ stage: 'third', best_of: 3 }, KEYS);
    assert.equal(v.needsFirst, true);
    assert.equal(v.next, null);
    assert.equal(v.nextAct, null);
    assert.deepEqual(v.maps, []);
  });

  test('an entry whose act does not match its step stops the list there (missing act = ban)', () => {
    const wrong = [...FULL.slice(0, 2), { side: 'a', map: 'mirage', act: 'ban' }, FULL[3]];
    let v = L.vetoState(bo3({ veto: wrong }), KEYS);
    assert.equal(v.steps.length, 2);
    assert.deepEqual(v.next, { side: 'a', step: 2 });
    assert.equal(v.nextAct, 'pick');
    v = L.vetoState(bo3({ veto: FULL.map(({ side, map }) => ({ side, map })) }), KEYS); // Bo1-style entries on a Bo3 match
    assert.equal(v.steps.length, 2);
    assert.deepEqual(v.picks, []);
    v = L.vetoState({ stage: 'group', veto: [{ side: 'a', map: 'nuke', act: 'pick' }] }, KEYS); // Bo1 never picks
    assert.equal(v.steps.length, 0);
  });

  test('undo of a pick: the pick disappears from picks and maps', () => {
    const v = L.vetoState(bo3({ veto: FULL.slice(0, 3) }), KEYS);
    assert.deepEqual(v.picks, ['mirage']);
    const u = L.vetoState(bo3({ veto: FULL.slice(0, 2) }), KEYS);
    assert.deepEqual(u.picks, []);
    assert.deepEqual(u.maps, []);
    assert.equal(u.nextAct, 'pick');
  });

  test('Bo1 keeps every old field and gains bo 1, all-ban acts, maps [map] once done', () => {
    const bans = ['nuke', 'cache', 'ancient', 'anubis', 'dust2', 'inferno'];
    const m = { stage: 'group', veto: bans.map((map, i) => ({ side: i % 2 ? 'b' : 'a', map })) };
    const v = L.vetoState(m, KEYS);
    assert.equal(v.map, 'mirage');
    assert.deepEqual(v.banned, bans);
    assert.equal(v.bo, 1);
    assert.deepEqual(v.acts, Array(6).fill('ban'));
    assert.deepEqual(v.picks, []);
    assert.deepEqual(v.maps, ['mirage']);
    assert.equal(v.nextAct, null);
    const half = L.vetoState({ stage: 'group', veto: m.veto.slice(0, 3) }, KEYS);
    assert.deepEqual(half.maps, []);
    assert.equal(half.nextAct, 'ban');
  });
});

describe('seriesState', () => {
  test('before the first game: game 1 is the first pick', () => {
    const s = L.seriesState(bo3({ games: [] }), KEYS);
    assert.deepEqual(s, { bo: 3, games: [], wonA: 0, wonB: 0, decided: false, winner: null, maps: ['mirage', 'inferno', 'dust2'],
      current: 0, currentMap: 'mirage', valid: true });
  });

  test('1:0 → game 2 on the other pick; 1:1 → decider; 2:1 decided', () => {
    let s = L.seriesState(bo3({ games: [{ a: 13, b: 10 }] }), KEYS);
    assert.equal(s.wonA, 1);
    assert.equal(s.current, 1);
    assert.equal(s.currentMap, 'inferno');
    s = L.seriesState(bo3({ games: [{ a: 13, b: 10 }, { a: 8, b: 13 }] }), KEYS);
    assert.deepEqual([s.wonA, s.wonB, s.current, s.currentMap, s.decided], [1, 1, 2, 'dust2', false]);
    s = L.seriesState(bo3({ games: [{ a: 13, b: 10 }, { a: 8, b: 13 }, { a: 19, b: 17 }] }), KEYS);
    assert.deepEqual(s.games, [
      { n: 1, map: 'mirage', a: 13, b: 10, winner: 'a', ot: false },
      { n: 2, map: 'inferno', a: 8, b: 13, winner: 'b', ot: false },
      { n: 3, map: 'dust2', a: 19, b: 17, winner: 'a', ot: true },
    ]);
    assert.deepEqual([s.wonA, s.wonB, s.decided, s.winner, s.current, s.currentMap, s.valid], [2, 1, true, 'a', null, null, true]);
  });

  test('2:0 ends the series; a game after that is ignored and marks the list invalid', () => {
    let s = L.seriesState(bo3({ games: [{ a: 3, b: 13 }, { a: 14, b: 16 }] }), KEYS);
    assert.deepEqual([s.wonA, s.wonB, s.winner, s.valid], [0, 2, 'b', true]);
    s = L.seriesState(bo3({ games: [{ a: 3, b: 13 }, { a: 14, b: 16 }, { a: 13, b: 0 }] }), KEYS);
    assert.deepEqual([s.games.length, s.wonA, s.wonB, s.winner, s.valid], [2, 0, 2, 'b', false]);
  });

  test('an illegal map score stops the list (no draw, knockout OT rules)', () => {
    for (const bad of [{ a: 12, b: 12 }, { a: 13, b: 12 }, { a: 15, b: 13 }, { a: 16, b: 15 }, { a: -1, b: 13 }, { a: '13', b: 'x' }, null, 'g']) {
      const s = L.seriesState(bo3({ games: [{ a: 13, b: 5 }, bad, { a: 13, b: 5 }] }), KEYS);
      assert.equal(s.games.length, 1, JSON.stringify(bad));
      assert.equal(s.valid, false);
      assert.equal(s.decided, false);
    }
    assert.equal(L.seriesState(bo3({ games: [{ a: '13', b: '7' }] }), KEYS).games[0].a, 13, 'digit strings are fine');
    assert.equal(L.seriesState(bo3({ games: 'x' }), KEYS).valid, false);
  });

  test('maps: m.maps (server) first, else the veto; a game map overrides; unknown keys → null', () => {
    let s = L.seriesState(bo3({ maps: ['nuke', 'cache', 'anubis'], games: [{ a: 13, b: 1 }] }), KEYS);
    assert.deepEqual(s.maps, ['nuke', 'cache', 'anubis']);
    assert.equal(s.games[0].map, 'nuke');
    assert.equal(s.currentMap, 'cache');
    s = L.seriesState(bo3({ games: [{ a: 13, b: 1, map: 'ancient' }, { a: 13, b: 1, map: 'overpass' }] }), KEYS);
    assert.deepEqual(s.games.map((g) => g.map), ['ancient', 'inferno']);
    s = L.seriesState({ stage: 'final', best_of: 3, maps: ['nuke', 'overpass'], games: [{ a: 13, b: 1 }, { a: 1, b: 13 }] }, KEYS);
    assert.deepEqual(s.maps, ['nuke', null]);
    assert.equal(s.currentMap, null, 'decider unknown (veto on paper)');
    s = L.seriesState({ stage: 'final', best_of: 3, games: [{ a: 13, b: 1 }] }, KEYS);
    assert.deepEqual([s.maps, s.games[0].map, s.currentMap], [[], null, null]);
  });

  test('public hold: the deciding game is still held but the series score is out → decided by the score', () => {
    let s = L.seriesState(bo3({ status: 'reported', score_a: 2, score_b: 1, games: [{ a: 13, b: 10 }, { a: 8, b: 13 }] }), KEYS);
    assert.deepEqual([s.games.length, s.wonA, s.wonB, s.decided, s.winner, s.current, s.valid], [2, 2, 1, true, 'a', null, true]);
    s = L.seriesState(bo3({ score_a: 0, score_b: 2, games: [] }), KEYS);
    assert.deepEqual([s.wonA, s.wonB, s.winner, s.valid], [0, 2, 'b', true]);
    // the score contradicts the visible games → the games win, valid false
    s = L.seriesState(bo3({ score_a: 2, score_b: 1, games: [{ a: 1, b: 13 }, { a: 2, b: 13 }] }), KEYS);
    assert.deepEqual([s.wonA, s.wonB, s.winner, s.valid], [0, 2, 'b', false]);
    s = L.seriesState(bo3({ score_a: 0, score_b: 2, games: [{ a: 13, b: 1 }] }), KEYS);
    assert.deepEqual([s.decided, s.valid], [false, false]);
    // a round score on a Bo3 match is not a series score
    s = L.seriesState(bo3({ score_a: 13, score_b: 7, games: [] }), KEYS);
    assert.deepEqual([s.decided, s.valid], [false, false]);
  });

  test('forfeit: 0:2 / 2:0 with no games; a junk forfeit value marks it invalid', () => {
    const s = L.seriesState(bo3({ forfeit: 'a', games: [{ a: 13, b: 1 }] }), KEYS);
    assert.deepEqual([s.games, s.wonA, s.wonB, s.decided, s.winner, s.current], [[], 0, 2, true, 'b', null]);
    assert.equal(L.seriesState(bo3({ forfeit: 'x', games: [] }), KEYS).valid, false);
  });

  test('Bo1: the match as one game once it has a legal result', () => {
    let s = L.seriesState({ stage: 'qf', map: 'nuke', score_a: 13, score_b: 7 }, KEYS);
    assert.deepEqual(s, { bo: 1, games: [{ n: 1, map: 'nuke', a: 13, b: 7, winner: 'a', ot: false }], wonA: 1, wonB: 0, decided: true,
      winner: 'a', maps: ['nuke'], current: null, currentMap: null, valid: true });
    s = L.seriesState({ stage: 'group', score_a: 12, score_b: 12 }, KEYS);
    assert.deepEqual([s.decided, s.winner, s.wonA, s.wonB], [true, null, 0, 0]);
    s = L.seriesState({ stage: 'qf', forfeit: 'b' }, KEYS);
    assert.deepEqual([s.games, s.wonA, s.winner], [[], 1, 'a']);
    s = L.seriesState({ stage: 'group', veto: ['nuke', 'cache', 'ancient', 'anubis', 'dust2', 'inferno'].map((map, i) => ({ side: i % 2 ? 'b' : 'a', map })) }, KEYS);
    assert.deepEqual([s.decided, s.current, s.currentMap, s.valid], [false, 0, 'mirage', true]);
    assert.equal(L.seriesState({ stage: 'qf', score_a: 13, score_b: 13 }, KEYS).valid, false);
  });

  test('never throws on junk', () => {
    for (const m of [null, undefined, 1, 'x', {}, { best_of: 3 }, { best_of: 3, games: [null, 1] }, { best_of: 3, maps: 'x', veto: 'y' }]) {
      assert.doesNotThrow(() => L.seriesState(m), String(m));
      assert.doesNotThrow(() => L.fmtSeries(m));
      assert.doesNotThrow(() => L.matchResult(m));
      assert.doesNotThrow(() => L.fmtScore(m));
    }
    assert.equal(L.seriesState(null).bo, 1);
  });
});

describe('matchResult / fmtScore / fmtSeries: Bo3', () => {
  const g21 = [{ a: 13, b: 10 }, { a: 8, b: 13 }, { a: 13, b: 11 }];

  test('matchResult: series score once decided, forfeit 2:0, else null', () => {
    assert.deepEqual(L.matchResult(bo3({ games: g21, score_a: 2, score_b: 1 })), { a: 2, b: 1, forfeit: null, ot: false, winner: 'a' });
    assert.deepEqual(L.matchResult(bo3({ games: g21 })), { a: 2, b: 1, forfeit: null, ot: false, winner: 'a' }, 'games alone decide');
    assert.deepEqual(L.matchResult(bo3({ games: [], score_a: 1, score_b: 2 })), { a: 1, b: 2, forfeit: null, ot: false, winner: 'b' });
    assert.deepEqual(L.matchResult(bo3({ forfeit: 'b' })), { a: 2, b: 0, forfeit: 'b', ot: false, winner: 'a' });
    assert.equal(L.matchResult(bo3({ games: g21.slice(0, 2) })), null);
    assert.equal(L.matchResult(bo3({ games: [], score_a: 13, score_b: 7 })), null);
    assert.equal(L.matchResult(bo3({ games: g21, forfeit: 'x' })), null);
  });

  test('fmtScore: "2 : 1", technical "2 : 0 (техникийн)", "" until decided; Bo1 unchanged', () => {
    assert.equal(L.fmtScore(bo3({ games: g21, score_a: 2, score_b: 1 })), '2 : 1');
    assert.equal(L.fmtScore(bo3({ games: [], score_a: 0, score_b: 2 })), '0 : 2');
    assert.equal(L.fmtScore(bo3({ forfeit: 'a' })), '0 : 2 (техникийн)');
    assert.equal(L.fmtScore(bo3({ forfeit: 'b' })), '2 : 0 (техникийн)');
    assert.equal(L.fmtScore(bo3({ games: g21.slice(0, 1) })), '');
    assert.equal(L.fmtScore({ stage: 'final', score_a: 16, score_b: 14 }), '16 : 14 (OT)');
  });

  test('fmtSeries: map scores in game order; "" for Bo1 and before the first game', () => {
    assert.equal(L.fmtSeries(bo3({ games: g21 })), '13:10 · 8:13 · 13:11');
    assert.equal(L.fmtSeries(bo3({ games: [{ a: 16, b: 14 }] })), '16:14');
    assert.equal(L.fmtSeries(bo3({ games: [] })), '');
    assert.equal(L.fmtSeries({ stage: 'final', score_a: 13, score_b: 7 }), '');
  });
});

describe('finalRanking / resolveMatches with a Bo3 final and 3rd-place match', () => {
  // Vector draw, every group in seat order; quarterfinals and semifinals all won by side a (Bo1):
  // final 19 = Багш нарын баг (4) vs 12а (1), 3rd-place match 20 = 11б (3) vs 11а (2).
  const base = () => playKO(playAllGroups(makeState()), { 13: 'a', 14: 'a', 15: 'a', 16: 'a', 17: 'a', 18: 'a' });

  test('resolveMatches carries best_of, maps and games from the state', () => {
    const s = base();
    setSeries(s, 19, [[13, 5], [5, 13]], { maps: ['mirage', 'inferno', 'dust2'] });
    const m = L.resolveMatches(s).find((x) => x.no === 19);
    assert.equal(L.bestOf(m), 3);
    assert.deepEqual(m.maps, ['mirage', 'inferno', 'dust2']);
    assert.equal(m.games.length, 2);
    assert.deepEqual([m.team_a, m.team_b], [T, 1]);
  });

  test('teachers win the Bo3 final 2:1 → the class finalist is champion; Bo3 3rd place decides 2nd and 3rd', () => {
    const s = base();
    setSeries(s, 19, [[13, 5], [5, 13]]); // 1:1, live
    setSeries(s, 20, [[13, 9], [16, 14]]); // 11б 2:0
    assert.deepEqual(L.finalRanking(s), { order: [null, null, 3, 2], classPlaces: [null, 3, 2], teachersAward: 'honor' });
    setSeries(s, 19, [[13, 5], [5, 13], [13, 11]]);
    assert.deepEqual(L.finalRanking(s), { order: [T, 1, 3, 2], classPlaces: [1, 3, 2], teachersAward: 'honor' });
  });

  test('a class team wins the Bo3 final; a forfeited 3rd-place series counts 2:0', () => {
    const s = base();
    setSeries(s, 19, [[11, 13], [10, 13]]); // 12а beats the teachers 2:0
    setSeries(s, 20, [], { forfeit: 'a' }); // 11б loses by forfeit → 11а 3rd-place winner
    assert.deepEqual(L.finalRanking(s), { order: [1, T, 2, 3], classPlaces: [1, 2, 3], teachersAward: 'honor' });
  });

  test('official by default: a reported (not final) series does not count; the held score still decides', () => {
    const s = base();
    setSeries(s, 19, [[13, 5], [13, 7]], { status: 'reported' });
    setSeries(s, 20, [[13, 9], [13, 9]]);
    assert.deepEqual(L.finalRanking(s).classPlaces, [null, 3, 2]);
    assert.deepEqual(L.finalRanking(s, { official: false }).classPlaces, [1, 3, 2]);
    match(s, 19).status = 'final';
    match(s, 19).games = match(s, 19).games.slice(0, 1); // public view: the deciding map still held, score already out
    assert.deepEqual(L.finalRanking(s), { order: [T, 1, 3, 2], classPlaces: [1, 3, 2], teachersAward: 'honor' });
  });

  test('without best_of the knockout stays Bo1 (fixtures, old states)', () => {
    const s = playKO(base(), { 19: 'b', 20: 'a' });
    assert.equal(L.bestOf(match(s, 19)), 1);
    assert.deepEqual(L.finalRanking(s), { order: [1, T, 3, 2], classPlaces: [1, 3, 2], teachersAward: 'honor' });
  });
});
