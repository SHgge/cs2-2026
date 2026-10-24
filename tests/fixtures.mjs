// Fixtures for tests/logic.test.mjs — synthetic data only (class names and numbers, no people).
import { TEAMS, MATCHES, GROUPS } from '../docs/js/event.js';

/** CONTRACT §3 draw test vector (must match in JS and SQL). */
export const VECTOR = Object.freeze({
  secret: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
  nums: { '12a': 1234, '11a': 5, '11b': 987, teachers: 42, '10a': 0, '10b': 9999, '10v': 313, '9a': 777, '9b': 2024, '8a': 8, '8b': 55, '8v': 1001 },
  inputs: '12a=1234,11a=5,11b=987,teachers=42,10a=0,10b=9999,10v=313,9a=777,9b=2024,8a=8,8b=55,8v=1001',
  seed: '362b441a74ad4f47eb6726b0238f078c114ca567640a5b96ea517dfa3f7d5798',
  groups: { A: ['teachers', '9a', '9b'], B: ['12a', '10b', '8v'], V: ['11b', '10a', '8a'], G: ['11a', '10v', '8b'] },
});

/** team code → id */
export const ID = Object.fromEntries(TEAMS.map((t) => [t.code, t.id]));

/** Seats of the vector draw, written out by hand: A1 = «Багш нарын баг» (4), A2 = 9а (8), … */
export const SEAT = Object.freeze({ A1: 4, A2: 8, A3: 9, B1: 1, B2: 6, B3: 12, V1: 3, V2: 5, V3: 10, G1: 2, G2: 7, G3: 11 });

/** A cs2_public_state-shaped object: vector draw (published by default), no results yet. */
export function makeState({ drawStatus = 'published', groups = VECTOR.groups } = {}) {
  return {
    ok: true,
    version: 1,
    now: '2026-10-24T08:00:00+08:00',
    settings: {
      reg_closes_at: '2026-10-23T23:59:59+08:00', consent_deadline_at: '2026-10-23T17:00:00+08:00',
      roster_freeze_at: '2026-10-23T23:59:59+08:00', registration_open: false, stream_url: null,
    },
    announcements: [],
    teams: TEAMS.map((t) => ({
      id: t.id, code: t.code, name: t.name, pot: t.pot, is_teachers: t.is_teachers, reg: { players: 6, confirmed: true, consents: 6 },
    })),
    draw: {
      status: drawStatus, commit: null, secret: null, inputs: null, seed: null,
      groups: drawStatus === 'none' ? null : structuredClone(groups), history: [],
    },
    matches: MATCHES.map((m) => ({
      no: m.no, stage: m.stage, code: m.code, grp: m.grp, station: m.station, start: m.start, end: m.end,
      status: 'scheduled', score_a: null, score_b: null, ot: null, forfeit: null, team_a: null, team_b: null,
    })),
    decisions: Object.fromEntries(GROUPS.map((g) => [g, { lot: null, approved: false }])),
  };
}

/** The state's match number `no`. */
export const match = (state, no) => state.matches.find((m) => m.no === no);

/** Writes a result into the state (status 'final' by default). */
export function setResult(state, no, a, b, { status = 'final', forfeit = null } = {}) {
  const m = match(state, no);
  m.status = status;
  m.score_a = a;
  m.score_b = b;
  m.forfeit = forfeit;
  m.ot = a != null && b != null ? Math.max(a, b) >= 16 : null;
  return m;
}

/** Group results by seat pair: {'12': [13, 7], '13': [13, 4, 'reported'], '23': [12, 12]} (missing pair = not played). */
export function playGroup(state, grp, scores, { status = 'final' } = {}) {
  for (const m of MATCHES) {
    if (m.stage !== 'group' || m.grp !== grp) continue;
    const s = scores[`${m.src_a.slice(-1)}${m.src_b.slice(-1)}`];
    if (s) setResult(state, m.no, s[0], s[1], { status: s[2] || status });
  }
  return state;
}

/** Plays group `grp` so that its seats finish in `order` (best first, e.g. [2, 1, 3]); every win is 13:5. */
export function playGroupOrder(state, grp, order = [1, 2, 3], opts = {}) {
  const pos = (s) => order.indexOf(s);
  const scores = {};
  for (const [x, y] of [[1, 2], [1, 3], [2, 3]]) scores[`${x}${y}`] = pos(x) < pos(y) ? [13, 5] : [5, 13];
  return playGroup(state, grp, scores, opts);
}

/** All four groups finish in seat order unless `orders[grp]` says otherwise. */
export function playAllGroups(state, orders = {}, opts = {}) {
  for (const g of GROUPS) playGroupOrder(state, g, orders[g] || [1, 2, 3], opts);
  return state;
}

/** Knockout results by winning side: {13: 'a', 14: 'b', …}; 'a' → 13:7, 'b' → 7:13. */
export function playKO(state, sides, { status = 'final' } = {}) {
  for (const [no, side] of Object.entries(sides)) {
    setResult(state, Number(no), side === 'a' ? 13 : 7, side === 'a' ? 7 : 13, { status });
  }
  return state;
}

/**
 * Makes match `no` a Bo3 series (as migration 14 does for 19/20) with map results [[a, b], …] in game order.
 * The series score (maps won) is written only once a side has 2 wins, as the server does; status 'final' by default
 * ('live' while undecided). forfeit 'a'/'b' = side that lost → 0:2 / 2:0, no games. maps optional.
 */
export function setSeries(state, no, games, { status, forfeit = null, maps = null } = {}) {
  const m = match(state, no);
  const list = forfeit ? [] : games.map(([a, b]) => ({ a, b }));
  const won = (side) => list.filter((g) => (side === 'a' ? g.a > g.b : g.b > g.a)).length;
  const sa = forfeit ? (forfeit === 'a' ? 0 : 2) : won('a');
  const sb = forfeit ? (forfeit === 'b' ? 0 : 2) : won('b');
  const decided = Math.max(sa, sb) === 2;
  Object.assign(m, {
    best_of: 3, games: list, maps, forfeit, ot: false, status: status || (decided ? 'final' : 'live'),
    score_a: decided ? sa : null, score_b: decided ? sb : null,
  });
  return m;
}

/** Small deterministic PRNG (mulberry32) so random-looking tests are reproducible. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** n random bytes as lowercase hex. */
export const randomHex = (rnd, n) => Array.from({ length: n }, () => Math.floor(rnd() * 256).toString(16).padStart(2, '0')).join('');
