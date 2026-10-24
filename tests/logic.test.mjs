// Tests for docs/js/event.js and docs/js/logic.js — run: npm test (node --test tests/)
// FULL_ENUM=1 npm test also runs the complete 6^4 × 2^8 bracket enumeration (~30 s).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import * as L from '../docs/js/logic.js';
import {
  GROUPS, GROUP_LABEL, GROUP_COLOR, STATION_LABEL, STAGE_LABEL, TEAMS, DRAW_ORDER, MATCHES, DAY_INFO,
  EVENT_NAME, CUP_NAME, CHAMPION_TITLE, DATES, DRAW_AT, FEE, PRIZES,
} from '../docs/js/event.js';
import {
  VECTOR, ID, SEAT, makeState, match, setResult, playGroup, playGroupOrder, playAllGroups, playKO, mulberry32, randomHex,
} from './fixtures.mjs';

const refHash = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const MIN = 60 * 1000;
const T = 4; // «Багш нарын баг»
const ids = (rows) => rows.map((r) => r.teamId);
const pair = (ms, no) => { const m = ms.find((x) => x.no === no); return [m.team_a, m.team_b]; };

// ================================================================ event.js
describe('event.js', () => {
  test('12 teams, 3 pots of 4, one teachers team (id 4), DRAW_ORDER = TEAMS order', () => {
    assert.equal(TEAMS.length, 12);
    assert.deepEqual(TEAMS.map((t) => t.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    assert.equal(new Set(TEAMS.map((t) => t.code)).size, 12);
    for (const pot of [1, 2, 3]) assert.equal(TEAMS.filter((t) => t.pot === pot).length, 4);
    assert.deepEqual(TEAMS.filter((t) => t.is_teachers).map((t) => [t.id, t.code, t.name]), [[4, 'teachers', 'Багш нарын баг']]);
    assert.deepEqual(DRAW_ORDER, TEAMS.map((t) => t.code));
    assert.deepEqual(TEAMS.filter((t) => t.pot === 1).map((t) => t.name), ['12а', '11а', '11б', 'Багш нарын баг']);
    assert.deepEqual(TEAMS.filter((t) => t.pot === 2).map((t) => t.name), ['10а', '10б', '10в', '9а']);
    assert.deepEqual(TEAMS.filter((t) => t.pot === 3).map((t) => t.name), ['9б', '8а', '8б', '8в']);
    assert.deepEqual(GROUPS, ['A', 'B', 'V', 'G']);
    assert.deepEqual(GROUP_LABEL, { A: 'А', B: 'Б', V: 'В', G: 'Г' });
    assert.deepEqual(GROUP_COLOR, { A: '#2563EB', B: '#16A34A', V: '#EA580C', G: '#9333EA' });
    assert.deepEqual(STATION_LABEL, { A: 'А станц', B: 'Б станц' });
    assert.equal(STAGE_LABEL.final, 'Финал');
  });

  test('20 matches: full ISO +08:00 times, SPEC §7 slots (60 min group, 75 min knockout, 165 min Bo3 final / 3rd place)', () => {
    assert.deepEqual(MATCHES.map((m) => m.no), Array.from({ length: 20 }, (_, i) => i + 1));
    const iso = /^2026-10-2[45]T\d\d:\d\d:00\+08:00$/;
    const hhmm = (s) => s.slice(11, 16);
    for (const m of MATCHES) {
      assert.match(m.start, iso, `#${m.no} start`);
      assert.match(m.end, iso, `#${m.no} end`);
      assert.equal(m.day, m.stage === 'group' ? 1 : 2);
      assert.equal(m.start.slice(0, 10), m.day === 1 ? '2026-10-24' : '2026-10-25');
      const slot = m.stage === 'group' ? 60 : m.stage === 'final' || m.stage === 'third' ? 165 : 75; // Bo3 (user 10.24): 3 × ~45 + 2 × 15 min
      assert.equal(Date.parse(m.end) - Date.parse(m.start), slot * MIN, `#${m.no} length`);
      assert.ok(m.stage === 'group' ? GROUPS.includes(m.grp) && m.code === null : m.grp === null && typeof m.code === 'string');
    }
    assert.deepEqual(MATCHES.map((m) => hhmm(m.start)), [
      '09:45', '09:45', '10:45', '10:45', '11:45', '11:45', '13:45', '13:45', '14:45', '14:45', '15:45', '15:45',
      '09:30', '09:30', '10:45', '10:45', '13:00', '13:00', '14:30', '14:30']);
    assert.deepEqual(MATCHES.slice(18).map((m) => hhmm(m.end)), ['17:15', '17:15']);
    assert.deepEqual(MATCHES.map((m) => m.stage), [...Array(12).fill('group'), 'qf', 'qf', 'qf', 'qf', 'sf', 'sf', 'final', 'third']);
    assert.deepEqual(MATCHES.slice(12).map((m) => m.code), ['1/4-1', '1/4-3', '1/4-2', '1/4-4', '1/2-1', '1/2-2', 'Финал', '3-р байр']);
    // nothing after 18:00 (SPEC §1)
    for (const m of MATCHES) assert.ok(hhmm(m.end) <= '18:00');
  });

  test('Day 1: full round robin per group, А/В on station A, Б/Г on station B, ≥1 slot rest per team', () => {
    for (const grp of GROUPS) {
      const ms = MATCHES.filter((m) => m.grp === grp);
      assert.deepEqual(ms.map((m) => `${m.src_a}-${m.src_b}`),
        [`seat:${grp}1-seat:${grp}2`, `seat:${grp}1-seat:${grp}3`, `seat:${grp}2-seat:${grp}3`]);
      for (const m of ms) assert.equal(m.station, grp === 'A' || grp === 'V' ? 'A' : 'B');
      for (const seat of [1, 2, 3]) {
        const mine = ms.filter((m) => m.src_a === `seat:${grp}${seat}` || m.src_b === `seat:${grp}${seat}`);
        assert.equal(mine.length, 2);
        assert.ok(Date.parse(mine[1].start) - Date.parse(mine[0].end) >= 60 * MIN, `${grp}${seat} needs a rest slot`);
      }
    }
  });

  test('never more than 2 matches at a time, one per station, no overlap on a station', () => {
    for (const st of ['A', 'B']) {
      const ms = MATCHES.filter((m) => m.station === st).sort((x, y) => Date.parse(x.start) - Date.parse(y.start));
      for (let i = 1; i < ms.length; i++) assert.ok(Date.parse(ms[i].start) >= Date.parse(ms[i - 1].end), `station ${st} overlap`);
    }
    for (const m of MATCHES) {
      const at = MATCHES.filter((x) => Date.parse(x.start) < Date.parse(m.end) && Date.parse(m.start) < Date.parse(x.end));
      assert.ok(at.length <= 2);
    }
  });

  test('Day 2 wiring per SPEC §3: А1–Б2, Б1–А2, В1–Г2, Г1–В2; 1/2 = W(1/4); final W, 3rd place L', () => {
    const src = Object.fromEntries(MATCHES.slice(12).map((m) => [m.no, [m.src_a, m.src_b]]));
    assert.deepEqual(src, {
      13: ['rank:A1', 'rank:B2'], 14: ['rank:B1', 'rank:A2'], 15: ['rank:V1', 'rank:G2'], 16: ['rank:G1', 'rank:V2'],
      17: ['W:13', 'W:15'], 18: ['W:14', 'W:16'], 19: ['W:17', 'W:18'], 20: ['L:17', 'L:18'],
    });
  });

  test('SPEC v5: name, deadlines (= migration 12), draw does not freeze rosters', () => {
    assert.equal(EVENT_NAME, 'Сургуулийн аварга – CS2 2026');
    assert.equal(CUP_NAME, 'Сургуулийн аварга');
    assert.equal(CHAMPION_TITLE, 'Сургуулийн аварга анги');
    assert.equal(DATES.reg_closes_at, '2026-10-23T23:59:59+08:00');
    assert.equal(DATES.roster_freeze_at, DATES.reg_closes_at);
    assert.equal(DATES.consent_deadline_at, '2026-10-23T17:00:00+08:00');
    assert.equal(DATES.fee_due_at, DATES.consent_deadline_at);
    assert.equal(DRAW_AT, '2026-10-22T16:00:00+08:00');
    assert.ok(Date.parse(DRAW_AT) < Date.parse(DATES.roster_freeze_at), 'draw happens before the roster freeze');
    assert.ok(Date.parse(DATES.roster_freeze_at) < Date.parse(MATCHES[0].start));
    for (const v of Object.values(DATES)) assert.match(v, /^2026-10-\d\dT\d\d:\d\d:\d\d\+08:00$/);
    const sql = readFileSync(new URL('../supabase/migrations/12_v5_name_deadlines.sql', import.meta.url), 'utf8');
    for (const k of ['reg_closes_at', 'consent_deadline_at', 'roster_freeze_at']) {
      assert.match(sql, new RegExp(`${k}\\s*=\\s*'${DATES[k].replace(/[+]/g, '\\+')}'`), `migration 12 ${k}`);
    }
  });

  test('SPEC v7: all 12 teams pay — 12 × 120 000 = 1 440 000 = cash 800 000 + award items 570 000 + reserve 70 000', () => {
    assert.equal(FEE.team, 120000);
    assert.equal(FEE.teams, TEAMS.length, 'the teachers\' team pays too');
    assert.equal(FEE.teams, 12);
    assert.equal(FEE.team * FEE.teams, FEE.total);
    assert.equal(FEE.total, 1440000);
    assert.equal(FEE.per_player * 6, FEE.team);
    assert.deepEqual(PRIZES.place, [360000, 240000, 120000]);
    assert.equal(PRIZES.place.reduce((a, b) => a + b, 0), PRIZES.places_total);
    assert.equal(PRIZES.places_total, 720000);
    assert.equal(PRIZES.mvp_cash, 80000);
    assert.equal(PRIZES.fund, 800000, 'cash fund, MVP included');
    assert.equal(PRIZES.places_total + PRIZES.mvp_cash, PRIZES.fund, 'places + MVP = fund (no double count)');
    assert.deepEqual(PRIZES.place.map((v) => v / 6), PRIZES.per_player);
    assert.deepEqual(PRIZES.per_player, [60000, 40000, 20000]);
    assert.equal(PRIZES.items, 570000);
    assert.equal(PRIZES.reserve, 70000);
    assert.equal(PRIZES.fund + PRIZES.items + PRIZES.reserve, FEE.total, 'balance 0');
    // award items (SPEC v7 §0c.3): cup 250 000 + plate 20 000 + medals 3 × 6 × 10 000 + өргөмжлөл 20 × 5 000 + MVP cup
    assert.equal(250000 + 20000 + 3 * 6 * 10000 + 20 * 5000 + PRIZES.mvp_cup, PRIZES.items);
    for (const x of [DATES, FEE, PRIZES, PRIZES.place, PRIZES.per_player]) assert.ok(Object.isFrozen(x));
  });

  test('DAY_INFO blocks and frozen exports', () => {
    assert.deepEqual(DAY_INFO.d1.map((x) => x[0]), ['08:30', '09:00', '09:30', '12:45', '16:45']);
    assert.deepEqual(DAY_INFO.d2.map((x) => x[0]), ['08:30', '08:45', '12:00', '14:15', '17:30']);
    assert.deepEqual(DAY_INFO.d2.slice(3), [['14:15', 'Завсарлага (14:30 хүртэл)'], ['17:30', 'Шагнал гардуулах, шилжин явах цом']]);
    assert.equal(DATES.links_expire_at, '2026-10-25T20:00:00+08:00'); // class/referee links (Bo3 day 2 ends later)
    for (const x of [GROUPS, TEAMS, TEAMS[0], MATCHES, MATCHES[0], DRAW_ORDER, DAY_INFO, DAY_INFO.d1[0]]) assert.ok(Object.isFrozen(x));
    assert.throws(() => { MATCHES[0].start = 'x'; }, TypeError);
  });

  test('pure modules: no DOM access, no innerHTML, no Node-only APIs', () => {
    for (const f of ['event.js', 'logic.js']) {
      const src = readFileSync(new URL(`../docs/js/${f}`, import.meta.url), 'utf8');
      assert.doesNotMatch(src, /\b(document|window|innerHTML|localStorage)\b/, f);
      assert.doesNotMatch(src, /\b(require|process|Buffer|__dirname)\b|from 'node:/, f);
    }
  });
});

// ================================================================ SHA-256
describe('sha256Hex', () => {
  const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  test('known vectors, UTF-8, lowercase hex', async () => {
    assert.equal(await L.sha256Hex(''), EMPTY);
    assert.equal(await L.sha256Hex('abc'), ABC);
    assert.equal(await L.sha256Hex('Сургуулийн аварга – CS2 2026'), refHash('Сургуулийн аварга – CS2 2026'));
    assert.match(await L.sha256Hex('x'), /^[0-9a-f]{64}$/);
    await assert.rejects(L.sha256Hex(42), TypeError);
    await assert.rejects(L.sha256Hex(null), TypeError);
  });

  test('pure-JS version equals node:crypto (block boundaries, multi-byte, random)', async () => {
    const rnd = mulberry32(7);
    const alphabet = 'abc019|=,АБВгдеёөү–😀 ';
    const samples = ['', 'abc'];
    for (const n of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000]) samples.push('x'.repeat(n), 'ө'.repeat(n));
    for (let i = 0; i < 300; i++) {
      const n = Math.floor(rnd() * 200);
      samples.push(Array.from({ length: n }, () => [...alphabet][Math.floor(rnd() * [...alphabet].length)]).join(''));
    }
    for (const s of samples) {
      const want = refHash(s);
      assert.equal(L.sha256HexSync(s), want, `sync, length ${s.length}`);
      assert.equal(await L.sha256Hex(s), want, `async, length ${s.length}`);
    }
  });

  test('falls back to pure JS when crypto.subtle is missing (plain-http LAN page)', async () => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    try {
      Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true, writable: true });
      assert.equal(await L.sha256Hex('abc'), ABC);
      const r = await L.computeDraw(VECTOR.secret, VECTOR.nums);
      assert.equal(r.seed, VECTOR.seed);
      assert.deepEqual(r.groups, VECTOR.groups);
    } finally {
      Object.defineProperty(globalThis, 'crypto', desc);
    }
    assert.equal(typeof globalThis.crypto.subtle.digest, 'function');
  });
});

// ================================================================ draw
function refDraw(secret, nums) { // independent implementation with node:crypto
  const inputs = DRAW_ORDER.map((c) => `${c}=${nums[c]}`).join(',');
  const seed = refHash(`cs2draw-v1|${secret.toLowerCase()}|${inputs}`);
  const groups = { A: [], B: [], V: [], G: [] };
  for (const pot of [1, 2, 3]) {
    TEAMS.filter((t) => t.pot === pot).map((t) => [refHash(`${seed}|${t.code}`), t.code]).sort()
      .forEach(([, code], i) => groups[GROUPS[i]].push(code));
  }
  return { inputs, seed, groups };
}

describe('draw', () => {
  test('drawInputsString: test vector, canonical numbers, input order irrelevant, extra keys ignored', () => {
    assert.equal(L.drawInputsString(VECTOR.nums), VECTOR.inputs);
    const shuffled = Object.fromEntries(Object.entries(VECTOR.nums).reverse());
    assert.equal(L.drawInputsString({ ...shuffled, test: 5, extra: 'x' }), VECTOR.inputs);
    const asStrings = Object.fromEntries(Object.entries(VECTOR.nums).map(([k, v]) => [k, String(v).padStart(4, '0')]));
    assert.equal(asStrings['11a'], '0005');
    assert.equal(L.drawInputsString(asStrings), VECTOR.inputs);
    assert.equal(L.drawInputsString({ ...VECTOR.nums, '12a': ' 7 ', '8v': -0 }), VECTOR.inputs.replace('12a=1234', '12a=7').replace('8v=1001', '8v=0'));
  });

  test('drawInputsString rejects missing or out-of-range numbers', () => {
    for (const bad of [undefined, null, '', -1, 10000, 1.5, NaN, Infinity, '12a', '1e3', '00042', '-5', true, [7], {}]) {
      assert.throws(() => L.drawInputsString({ ...VECTOR.nums, teachers: bad }), RangeError, String(bad));
    }
    assert.throws(() => L.drawInputsString(null), RangeError);
    assert.equal(L.parseDrawNum(9999), 9999);
    assert.equal(L.parseDrawNum('0'), 0);
    assert.equal(L.parseDrawNum(10000), null);
  });

  test('computeDraw: CONTRACT test vector (inputs, seed, groups, keys)', async () => {
    const r = await L.computeDraw(VECTOR.secret, VECTOR.nums);
    assert.equal(r.inputs, VECTOR.inputs);
    assert.equal(r.seed, VECTOR.seed);
    assert.deepEqual(r.groups, VECTOR.groups);
    assert.deepEqual(Object.keys(r.keys), DRAW_ORDER);
    for (const code of DRAW_ORDER) assert.equal(r.keys[code], refHash(`${VECTOR.seed}|${code}`));
    assert.deepEqual(await L.computeDraw(VECTOR.secret.toUpperCase(), VECTOR.nums), r); // secret is lower-cased
    assert.deepEqual(refDraw(VECTOR.secret, VECTOR.nums), { inputs: r.inputs, seed: r.seed, groups: r.groups });
  });

  test('computeDraw changes with any number and rejects bad input', async () => {
    const a = await L.computeDraw(VECTOR.secret, { ...VECTOR.nums, '8v': 1002 });
    assert.notEqual(a.seed, VECTOR.seed);
    await assert.rejects(L.computeDraw('', VECTOR.nums), TypeError);
    await assert.rejects(L.computeDraw(null, VECTOR.nums), TypeError);
    await assert.rejects(L.computeDraw(VECTOR.secret, { ...VECTOR.nums, '9b': 12345 }), RangeError);
  });

  test('2 000 random secrets: every group gets exactly one team per pot (seat = pot), matches node:crypto, fair spread', async () => {
    const rnd = mulberry32(20261022);
    const potOf = Object.fromEntries(TEAMS.map((t) => [t.code, t.pot]));
    const spread = Object.fromEntries(DRAW_ORDER.map((c) => [c, { A: 0, B: 0, V: 0, G: 0 }]));
    const N = 2000;
    for (let i = 0; i < N; i++) {
      const secret = randomHex(rnd, 32);
      const nums = Object.fromEntries(DRAW_ORDER.map((c) => [c, Math.floor(rnd() * 10000)]));
      const r = await L.computeDraw(secret, nums);
      const all = GROUPS.flatMap((g) => r.groups[g]);
      if (all.length !== 12 || new Set(all).size !== 12) assert.fail(`draw ${i}: not 12 distinct teams`);
      for (const g of GROUPS) {
        if (r.groups[g].length !== 3) assert.fail(`draw ${i}: group ${g} size`);
        r.groups[g].forEach((code, s) => {
          if (potOf[code] !== s + 1) assert.fail(`draw ${i}: ${g}${s + 1} = ${code} is not from pot ${s + 1}`);
          spread[code][g] += 1;
        });
      }
      for (let s = 0; s < 3; s++) { // keys ascend А → Б → В → Г inside each pot
        const ks = GROUPS.map((g) => r.keys[r.groups[g][s]]);
        if (!(ks[0] < ks[1] && ks[1] < ks[2] && ks[2] < ks[3])) assert.fail(`draw ${i}: pot ${s + 1} not sorted by key`);
      }
      const ref = refDraw(secret, nums);
      if (r.seed !== ref.seed || JSON.stringify(r.groups) !== JSON.stringify(ref.groups)) assert.fail(`draw ${i}: differs from reference`);
    }
    for (const code of DRAW_ORDER) {
      for (const g of GROUPS) assert.ok(Math.abs(spread[code][g] - N / 4) < 120, `${code} in ${g}: ${spread[code][g]}`);
    }
  });
});

// ================================================================ scores
describe('validScore / matchResult / fmtScore', () => {
  test('validScore table', () => {
    const cases = [
      // regulation MR12: 13:0…13:11
      ['group', 13, 11, true], ['group', 11, 13, true], ['group', 13, 0, true], ['group', 0, 13, true],
      ['group', 13, 12, false], ['group', 12, 13, false], ['group', 13, 13, false], ['group', 14, 12, false], ['group', 0, 0, false],
      // 12:12 is a draw in the group stage only
      ['group', 12, 12, true], ['qf', 12, 12, false], ['sf', 12, 12, false], ['final', 12, 12, false], ['third', 12, 12, false],
      // knockout regulation
      ['qf', 13, 11, true], ['third', 3, 13, true], ['sf', 13, 12, false],
      // overtime MR3: W = 16 + 3k, W-4 ≤ L ≤ W-2
      ['qf', 16, 14, true], ['qf', 16, 13, true], ['qf', 16, 12, true], ['qf', 16, 15, false], ['qf', 16, 11, false],
      ['sf', 19, 17, true], ['sf', 19, 15, true], ['sf', 19, 18, false], ['sf', 19, 14, false], ['final', 14, 16, true],
      ['final', 17, 15, false], ['final', 18, 16, false], ['final', 22, 20, true], ['third', 25, 21, true], ['third', 25, 24, false],
      ['group', 16, 14, false], ['group', 19, 17, false], // no overtime in groups
      // inputs
      ['group', '13', '9', true], ['qf', ' 16 ', '14', true], ['group', 13.5, 9, false], ['group', -1, 13, false],
      ['group', null, 13, false], ['group', 13, undefined, false], ['group', '13a', 9, false], ['bogus', 13, 9, false], [undefined, 13, 9, false],
    ];
    for (const [stage, a, b, want] of cases) assert.equal(L.validScore(stage, a, b), want, `${stage} ${a}:${b}`);
  });

  test('validScore forfeits: the side that LOST is given; only 13:0 for the other side is legal', () => {
    assert.equal(L.validScore('group', 13, 0, 'b'), true);
    assert.equal(L.validScore('group', 0, 13, 'a'), true);
    assert.equal(L.validScore('qf', 0, 13, 'a'), true);
    assert.equal(L.validScore('final', 13, 0, 'b'), true);
    assert.equal(L.validScore('group', 13, 0, 'a'), false);
    assert.equal(L.validScore('group', 0, 13, 'b'), false);
    assert.equal(L.validScore('qf', 13, 5, 'b'), false);
    assert.equal(L.validScore('group', null, null, 'a'), false);
    assert.equal(L.validScore('group', 13, 0, 'x'), false);
    assert.equal(L.validScore('group', 13, 9, ''), true); // '' / null / undefined = no forfeit
    assert.equal(L.validScore('group', 13, 9, null), true);
  });

  test('matchResult: winner, draw, OT, forfeit', () => {
    assert.deepEqual(L.matchResult({ stage: 'group', score_a: 12, score_b: 12 }), { a: 12, b: 12, forfeit: null, ot: false, winner: null });
    assert.deepEqual(L.matchResult({ stage: 'qf', score_a: 14, score_b: 16 }), { a: 14, b: 16, forfeit: null, ot: true, winner: 'b' });
    assert.deepEqual(L.matchResult({ stage: 'qf', forfeit: 'a', score_a: null, score_b: null }), { a: 0, b: 13, forfeit: 'a', ot: false, winner: 'b' });
    assert.deepEqual(L.matchResult({ stage: 'group', forfeit: 'b' }), { a: 13, b: 0, forfeit: 'b', ot: false, winner: 'a' });
    assert.equal(L.matchResult({ stage: 'qf', score_a: 12, score_b: 12 }), null);
    assert.equal(L.matchResult({ stage: 'group', score_a: 13, score_b: 12 }), null);
    assert.equal(L.matchResult({ stage: 'group', score_a: 13, score_b: 2, forfeit: 'x' }), null);
    assert.equal(L.matchResult({ stage: 'group', score_a: null, score_b: null }), null);
    assert.equal(L.matchResult(null), null);
  });

  test('fmtScore strings', () => {
    assert.equal(L.fmtScore({ score_a: 13, score_b: 9 }), '13 : 9');
    assert.equal(L.fmtScore({ score_a: 9, score_b: 13 }), '9 : 13');
    assert.equal(L.fmtScore({ score_a: 12, score_b: 12 }), '12 : 12');
    assert.equal(L.fmtScore({ score_a: 16, score_b: 14, ot: true }), '16 : 14 (OT)');
    assert.equal(L.fmtScore({ score_a: 17, score_b: 19, ot: null }), '17 : 19 (OT)'); // OT read from the score
    assert.equal(L.fmtScore({ forfeit: 'b', score_a: 13, score_b: 0 }), '13 : 0 (техникийн)');
    assert.equal(L.fmtScore({ forfeit: 'a', score_a: null, score_b: null }), '0 : 13 (техникийн)');
    assert.equal(L.fmtScore({ score_a: '13', score_b: '7' }), '13 : 7');
    assert.equal(L.fmtScore({ status: 'live', score_a: null, score_b: null }), '');
    assert.equal(L.fmtScore(null), '');
  });
});

// ================================================================ seats and labels
describe('seatMap / srcLabel / teachersTeamId', () => {
  test('seatMap: null before the draw is published; seats = pots after', () => {
    assert.equal(L.seatMap(null), null);
    assert.equal(L.seatMap({}), null);
    for (const status of ['none', 'committed', 'computed']) assert.equal(L.seatMap(makeState({ drawStatus: status })), null, status);
    assert.deepEqual(L.seatMap(makeState()), SEAT);
    assert.deepEqual(L.seatMap(makeState({ drawStatus: 'computed' }), { includeComputed: true }), SEAT);
    for (const [seat, id] of Object.entries(SEAT)) assert.equal(TEAMS.find((t) => t.id === id).pot, Number(seat[1]));
    const noTeams = makeState();
    delete noTeams.teams;
    assert.deepEqual(L.seatMap(noTeams), SEAT); // falls back to event.js ids
    const odd = makeState();
    odd.draw.groups.G[2] = 'nope';
    assert.equal(L.seatMap(odd).G3, null);
  });

  test('srcLabel matches the printed posters', () => {
    assert.equal(L.srcLabel('seat:A1'), 'А1');
    assert.equal(L.srcLabel('seat:G3'), 'Г3');
    assert.equal(L.srcLabel('rank:B2'), 'Б№2');
    assert.equal(L.srcLabel('rank:V1', { long: true }), 'В хэсгийн 1-р байр');
    assert.deepEqual(['W:13', 'W:14', 'W:15', 'W:16', 'W:17', 'W:18', 'L:17', 'L:18'].map((s) => L.srcLabel(s)), [
      '1/4-1-ийн ялагч', '1/4-3-ын ялагч', '1/4-2-ын ялагч', '1/4-4-ийн ялагч',
      '1/2-1-ийн ялагч', '1/2-2-ын ялагч', '1/2-1-ийн ялагдагч', '1/2-2-ын ялагдагч']);
    for (const bad of [null, '', 'seat:X1', 'rank:A4', 'W:99', 'W:1', 'zzz']) assert.equal(L.srcLabel(bad), '', String(bad));
  });

  test('teachersTeamId', () => {
    assert.equal(L.teachersTeamId(makeState()), 4);
    assert.equal(L.teachersTeamId(null), 4);
  });
});

// ================================================================ group standings
describe('groupStandings', () => {
  test('pending: before the draw no rows; after the draw seat order, rank null', () => {
    assert.deepEqual(L.groupStandings(makeState({ drawStatus: 'committed' }), 'A'),
      { grp: 'A', rows: [], status: 'pending', tied: [], tiebreaks: [], counted: 0, approved: false });
    const st = L.groupStandings(makeState(), 'A');
    assert.equal(st.status, 'pending');
    assert.deepEqual(st.rows.map((r) => [r.teamId, r.seat, r.rank]), [[4, 1, null], [8, 2, null], [9, 3, null]]);
    assert.equal(L.groupStandings(makeState(), 'X').status, 'pending');
    assert.equal(L.groupStandings(null, 'A').status, 'pending');
  });

  test('simple: 6 / 3 / 0 points, full row data, complete', () => {
    const s = playGroup(makeState(), 'A', { 12: [13, 7], 13: [13, 4], 23: [13, 11] });
    const st = L.groupStandings(s, 'A', { official: true });
    assert.deepEqual(st.rows, [
      { teamId: 4, seat: 1, p: 2, w: 2, d: 0, l: 0, rf: 26, ra: 11, rd: 15, pts: 6, rank: 1 },
      { teamId: 8, seat: 2, p: 2, w: 1, d: 0, l: 1, rf: 20, ra: 24, rd: -4, pts: 3, rank: 2 },
      { teamId: 9, seat: 3, p: 2, w: 0, d: 0, l: 2, rf: 15, ra: 26, rd: -11, pts: 0, rank: 3 },
    ]);
    assert.equal(st.status, 'complete');
    assert.deepEqual([st.tied, st.tiebreaks, st.counted], [[], [], 3]);
  });

  test('12:12 draws count 1 point; level teams split by round difference', () => {
    const s = playGroup(makeState(), 'A', { 12: [12, 12], 13: [13, 5], 23: [13, 9] });
    const st = L.groupStandings(s, 'A');
    assert.deepEqual(st.rows.map((r) => [r.teamId, r.w, r.d, r.l, r.pts, r.rd, r.rank]), [[4, 1, 1, 0, 4, 8, 1], [8, 1, 1, 0, 4, 4, 2], [9, 0, 0, 2, 0, -12, 3]]);
    assert.deepEqual(st.tiebreaks, [{ teams: [4, 8], by: 'rd' }]);
    assert.equal(st.status, 'complete');
  });

  test('two-way tie decided by head-to-head before round difference (incomplete group)', () => {
    // In a complete 3-team group a two-way points tie always comes from a 12:12 between the two,
    // so a deciding head-to-head can only appear while the group is unfinished.
    const s = playGroup(makeState(), 'A', { 12: [13, 0], 13: [11, 13] });
    const st = L.groupStandings(s, 'A');
    assert.deepEqual(st.rows.map((r) => [r.teamId, r.pts, r.rd, r.rank]), [[9, 3, 2, 1], [4, 3, 11, 2], [8, 0, -13, 3]]);
    assert.deepEqual(st.tiebreaks, [{ teams: [4, 9], by: 'h2h' }]);
    assert.equal(st.status, 'provisional');
    assert.equal(st.counted, 2);
  });

  test('three-way circular tie decided by round difference', () => {
    const s = playGroup(makeState(), 'A', { 12: [13, 5], 23: [13, 11], 13: [10, 13] });
    const st = L.groupStandings(s, 'A', { official: true });
    assert.deepEqual(st.rows.map((r) => [r.teamId, r.pts, r.rd, r.rank]), [[4, 3, 5, 1], [9, 3, 1, 2], [8, 3, -6, 3]]);
    assert.deepEqual(st.tiebreaks, [{ teams: [4, 8, 9], by: 'rd' }]);
    assert.equal(st.status, 'complete');
  });

  test('three-way tie, then head-to-head is re-applied to the two still level (not rounds won)', () => {
    const s = playGroup(makeState(), 'A', { 12: [13, 7], 23: [13, 9], 13: [11, 13] });
    const st = L.groupStandings(s, 'A', { official: true });
    assert.deepEqual(st.rows.map((r) => [r.teamId, r.pts, r.rd, r.rf, r.rank]), [[4, 3, 4, 24, 1], [8, 3, -2, 20, 2], [9, 3, -2, 22, 3]]);
    assert.ok(st.rows[2].rf > st.rows[1].rf, 'rounds won alone would have put 9б ahead');
    assert.deepEqual(st.tiebreaks, [{ teams: [4, 8, 9], by: 'rd' }, { teams: [8, 9], by: 'h2h' }]);
    assert.equal(st.status, 'complete');
  });

  test('unresolved three-way tie → needs_lot; lot order applied → complete', () => {
    const s = playGroup(makeState(), 'A', { 12: [12, 12], 13: [12, 12], 23: [12, 12] });
    let st = L.groupStandings(s, 'A', { official: true });
    assert.equal(st.status, 'needs_lot');
    assert.deepEqual(st.tied, [[4, 8, 9]]);
    assert.deepEqual(st.rows.map((r) => [r.teamId, r.pts, r.rank]), [[4, 2, 1], [8, 2, 1], [9, 2, 1]]);
    s.decisions.A.lot = [9, 4, 8];
    st = L.groupStandings(s, 'A', { official: true });
    assert.equal(st.status, 'complete');
    assert.deepEqual(st.rows.map((r) => [r.teamId, r.rank]), [[9, 1], [4, 2], [8, 3]]);
    assert.deepEqual(st.tiebreaks, [{ teams: [4, 8, 9], by: 'lot' }]);
    assert.deepEqual(st.tied, []);
  });

  test('unresolved two-way tie for 1st → needs_lot; partial lot ignored; lot only orders the tied block', () => {
    const s = playGroup(makeState(), 'A', { 12: [12, 12], 13: [13, 7], 23: [13, 7] });
    let st = L.groupStandings(s, 'A', { official: true });
    assert.equal(st.status, 'needs_lot');
    assert.deepEqual(st.tied, [[4, 8]]);
    assert.deepEqual(st.rows.map((r) => [r.teamId, r.rank]), [[4, 1], [8, 1], [9, 3]]);
    s.decisions.A.lot = [8];
    assert.equal(L.groupStandings(s, 'A', { official: true }).status, 'needs_lot');
    s.decisions.A.lot = [9, 8, 4];
    st = L.groupStandings(s, 'A', { official: true });
    assert.equal(st.status, 'complete');
    assert.deepEqual(st.rows.map((r) => [r.teamId, r.rank]), [[8, 1], [4, 2], [9, 3]]);
    s.decisions.A.approved = true;
    assert.equal(L.groupStandings(s, 'A').approved, true);
  });

  test('a lot never overrides points or other criteria', () => {
    const s = playGroup(makeState(), 'A', { 12: [13, 7], 13: [13, 4], 23: [13, 11] });
    s.decisions.A.lot = [9, 8, 4];
    const st = L.groupStandings(s, 'A');
    assert.deepEqual(ids(st.rows), [4, 8, 9]);
    assert.deepEqual(st.tiebreaks, []);
  });

  test('provisional (reported|final) vs official (final only)', () => {
    const s = playGroupOrder(makeState(), 'A', [1, 2, 3]);
    match(s, 9).status = 'reported';
    const off = L.groupStandings(s, 'A', { official: true });
    assert.equal(off.counted, 2);
    assert.equal(off.status, 'provisional');
    assert.deepEqual(off.rows.map((r) => [r.teamId, r.rank]), [[4, 1], [8, 2], [9, 2]]);
    assert.deepEqual(off.tied, [[8, 9]]);
    const prov = L.groupStandings(s, 'A');
    assert.equal(prov.counted, 3);
    assert.equal(prov.status, 'provisional');
    assert.deepEqual(prov.rows.map((r) => [r.teamId, r.rank]), [[4, 1], [8, 2], [9, 3]]);
    assert.deepEqual(L.groupStandings(s, 'A', true).counted, 2); // boolean shorthand
    match(s, 9).status = 'final';
    assert.equal(L.groupStandings(s, 'A', { official: true }).status, 'complete');
    assert.equal(L.groupStandings(s, 'A').status, 'complete');
  });

  test('live / scheduled / illegal scores are not counted; forfeits count 13:0', () => {
    const s = makeState();
    setResult(s, 1, 13, 2, { status: 'live' });
    setResult(s, 5, 13, 12); // illegal
    assert.equal(L.groupStandings(s, 'A').status, 'pending');
    setResult(s, 1, null, null, { forfeit: 'a' }); // А1 (Багш нарын баг) lost by forfeit → А2 (9а) wins 13:0
    const st = L.groupStandings(s, 'A');
    assert.deepEqual(st.rows.map((r) => [r.teamId, r.p, r.rf, r.ra, r.pts]), [[8, 1, 13, 0, 3], [9, 0, 0, 0, 0], [4, 1, 0, 13, 0]]);
  });
});

// ================================================================ bracket resolution
describe('resolveMatches', () => {
  test('never throws; unknown → null; returns fresh copies in match order', () => {
    for (const bad of [null, undefined, {}, 42, 'x', { matches: [null, 5, 'x', { no: '3', status: 'final', score_a: 13, score_b: 2 }] },
      { draw: { status: 'published', groups: 'nope' } }, { draw: { status: 'published', groups: { A: null } }, matches: {} }]) {
      const ms = L.resolveMatches(bad);
      assert.equal(ms.length, 20);
      assert.ok(ms.every((m) => m.team_a === null && m.team_b === null));
    }
    const ms = L.resolveMatches(null);
    assert.deepEqual(ms.map((m) => m.no), MATCHES.map((m) => m.no));
    assert.ok(ms.every((m) => m.status === 'scheduled'));
    ms[0].team_a = 5;
    ms[0].start = 'changed';
    assert.equal(MATCHES[0].start, '2026-10-24T09:45:00+08:00');
    assert.equal(L.resolveMatches(null)[0].team_a, null);
  });

  test('group matches from the published seats; state times/status win, stored team ids ignored', () => {
    assert.ok(L.resolveMatches(makeState({ drawStatus: 'computed' })).every((m) => m.team_a === null));
    const s = makeState();
    match(s, 1).start = '2026-10-24T16:45:00+08:00';
    match(s, 1).status = 'live';
    match(s, 13).team_a = 99;
    match(s, 13).code = 'QF1'; // knockout codes always come from event.js (posters, srcLabel)
    match(s, 14).station = null;
    const ms = L.resolveMatches(s);
    assert.equal(ms[12].code, '1/4-1');
    assert.equal(ms[13].station, 'B');
    const want = [[4, 8], [1, 6], [3, 5], [2, 7], [4, 9], [1, 12], [3, 10], [2, 11], [8, 9], [6, 12], [5, 10], [7, 11]];
    assert.deepEqual(ms.slice(0, 12).map((m) => [m.team_a, m.team_b]), want);
    assert.equal(ms[0].start, '2026-10-24T16:45:00+08:00');
    assert.equal(ms[0].status, 'live');
    assert.equal(ms[0].src_a, 'seat:A1');
    assert.deepEqual(pair(ms, 13), [null, null]);
  });

  test('quarterfinals filled only from complete groups (official); provisional option uses reported results', () => {
    const s = playAllGroups(makeState());
    match(s, 12).status = 'reported'; // group Г not final yet
    let ms = L.resolveMatches(s);
    assert.deepEqual([pair(ms, 13), pair(ms, 14), pair(ms, 15), pair(ms, 16)], [[4, 6], [1, 8], [3, null], [null, 5]]);
    ms = L.resolveMatches(s, { official: false });
    assert.deepEqual([pair(ms, 15), pair(ms, 16)], [[3, 7], [2, 5]]);
    match(s, 12).status = 'final';
    ms = L.resolveMatches(s);
    assert.deepEqual([pair(ms, 15), pair(ms, 16)], [[3, 7], [2, 5]]);
  });

  test('a group that needs a lot fills no quarterfinal slot until the lot is entered', () => {
    const s = playAllGroups(makeState());
    playGroup(s, 'A', { 12: [12, 12], 13: [13, 7], 23: [13, 7] });
    let ms = L.resolveMatches(s);
    assert.deepEqual([pair(ms, 13), pair(ms, 14)], [[null, 6], [1, null]]);
    s.decisions.A.lot = [8, 4];
    ms = L.resolveMatches(s);
    assert.deepEqual([pair(ms, 13), pair(ms, 14)], [[8, 6], [1, 4]]);
  });

  test('winners and losers move on from final knockout results (incl. OT and forfeit)', () => {
    const s = playAllGroups(makeState());
    playKO(s, { 13: 'a', 14: 'b', 15: 'a', 16: 'b' });
    let ms = L.resolveMatches(s);
    assert.deepEqual([pair(ms, 17), pair(ms, 18), pair(ms, 19), pair(ms, 20)], [[4, 3], [8, 5], [null, null], [null, null]]);
    playKO(s, { 17: 'b', 18: 'a' });
    ms = L.resolveMatches(s);
    assert.deepEqual([pair(ms, 19), pair(ms, 20)], [[3, 8], [4, 5]]);
    match(s, 17).status = 'reported';
    assert.deepEqual([pair(L.resolveMatches(s), 19), pair(L.resolveMatches(s), 20)], [[null, 8], [null, 5]]);
    ms = L.resolveMatches(s, { official: false });
    assert.deepEqual([pair(ms, 19), pair(ms, 20)], [[3, 8], [4, 5]]);
    setResult(s, 13, 14, 16); // OT, B2 (10б) wins
    assert.equal(pair(L.resolveMatches(s), 17)[0], 6);
    setResult(s, 13, null, null, { forfeit: 'b' }); // 10б lost by forfeit
    assert.equal(pair(L.resolveMatches(s), 17)[0], 4);
    setResult(s, 13, 12, 12); // illegal in knockout → nothing moves on
    assert.equal(pair(L.resolveMatches(s), 17)[0], null);
  });
});

// ================================================================ final ranking (SPEC §4)
describe('finalRanking / class places', () => {
  // Vector draw, every group in seat order: А1 = Багш нарын баг (4), Б2 = 10б (6), Б1 = 12а (1), А2 = 9а (8),
  // В1 = 11б (3), Г2 = 10в (7), Г1 = 11а (2), В2 = 10а (5).
  const run = (sides) => playKO(playAllGroups(makeState()), sides);
  const ALL_A = { 13: 'a', 14: 'a', 15: 'a', 16: 'a', 17: 'a', 18: 'a', 19: 'a', 20: 'a' };

  test('nothing decided yet', () => {
    assert.deepEqual(L.finalRanking(makeState()), { order: [null, null, null, null], classPlaces: [null, null, null], teachersAward: null });
    assert.deepEqual(L.finalRanking(null).classPlaces, [null, null, null]);
  });

  test('teachers out early (lose 1/4): plain order, «Тусгай өргөмжлөл»', () => {
    const s = run({ 13: 'b' });
    assert.equal(L.finalRanking(s).teachersAward, 'special'); // known as soon as the quarterfinal is final
    playKO(s, { 14: 'a', 15: 'a', 16: 'a', 17: 'a', 18: 'a', 19: 'a' });
    assert.deepEqual(L.finalRanking(s).classPlaces, [6, 1, null]); // 3rd place waits for the 3rd-place match
    playKO(s, { 20: 'a' });
    assert.deepEqual(L.finalRanking(s), { order: [6, 1, 3, 2], classPlaces: [6, 1, 3], teachersAward: 'special' });
  });

  test('teachers out in the group: «Тусгай өргөмжлөл» once the group is complete', () => {
    const s = playAllGroups(makeState(), { A: [2, 3, 1] });
    assert.equal(L.finalRanking(s).teachersAward, 'special');
    match(s, 9).status = 'reported';
    assert.equal(L.finalRanking(s).teachersAward, null);
  });

  test('teachers win the final → class finalist is champion; 3rd-place winner 2nd, loser 3rd', () => {
    const s = run({ 13: 'a', 14: 'a', 15: 'a', 16: 'a', 17: 'a', 18: 'a', 20: 'a' });
    assert.deepEqual(L.finalRanking(s).classPlaces, [null, 3, 2]);
    playKO(s, { 19: 'a' });
    assert.deepEqual(L.finalRanking(s), { order: [4, 1, 3, 2], classPlaces: [1, 3, 2], teachersAward: 'honor' });
  });

  test('teachers lose the final → same class places', () => {
    const s = run({ ...ALL_A, 19: 'b' });
    assert.deepEqual(L.finalRanking(s), { order: [1, 4, 3, 2], classPlaces: [1, 3, 2], teachersAward: 'honor' });
  });

  test('teachers win the 3rd-place match → their opponent class is 3rd', () => {
    const s = run({ 13: 'a', 14: 'a', 15: 'a', 16: 'a', 17: 'b', 18: 'a' });
    assert.deepEqual(L.finalRanking(s), { order: [null, null, null, null], classPlaces: [null, null, 2], teachersAward: 'honor' });
    playKO(s, { 19: 'a', 20: 'a' });
    assert.deepEqual(L.finalRanking(s), { order: [3, 1, 4, 2], classPlaces: [3, 1, 2], teachersAward: 'honor' });
  });

  test('teachers lose the 3rd-place match → their opponent class is still 3rd', () => {
    const s = run({ 13: 'a', 14: 'a', 15: 'a', 16: 'a', 17: 'b', 18: 'a', 19: 'a', 20: 'b' });
    assert.deepEqual(L.finalRanking(s), { order: [3, 1, 2, 4], classPlaces: [3, 1, 2], teachersAward: 'honor' });
  });

  test('official by default: a reported (not final) final does not crown anyone', () => {
    const s = run(ALL_A);
    match(s, 19).status = 'reported';
    assert.deepEqual(L.finalRanking(s).classPlaces, [null, 3, 2]);
    assert.deepEqual(L.finalRanking(s, { official: false }).classPlaces, [1, 3, 2]);
  });
});

// ================================================================ property: same-group meetings
describe('property: same-group teams meet again only in the final or the 3rd-place match', () => {
  const PERMS = [[1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1]];
  const groupOf = new Map(Object.entries(SEAT).map(([seat, id]) => [id, seat[0]]));
  const met = { final: 0, third: 0 };

  function check(s, label) {
    const ms = L.resolveMatches(s);
    for (const m of ms) {
      if (m.team_a == null || m.team_b == null || m.team_a === m.team_b) assert.fail(`${label}: match ${m.no} is ${m.team_a}–${m.team_b}`);
      if (m.stage !== 'group' && groupOf.get(m.team_a) === groupOf.get(m.team_b)) {
        if (m.stage !== 'final' && m.stage !== 'third') assert.fail(`${label}: same group meets in ${m.code}`);
        met[m.stage] += 1;
      }
    }
    for (const stage of ['qf', 'sf']) {
      const t = ms.filter((m) => m.stage === stage).flatMap((m) => [m.team_a, m.team_b]);
      if (new Set(t).size !== t.length) assert.fail(`${label}: a team plays twice in ${stage}`);
    }
    const fr = L.finalRanking(s);
    if (fr.order.some((x) => x == null) || new Set(fr.order).size !== 4) assert.fail(`${label}: order ${fr.order}`);
    const want = fr.order.filter((id) => id !== T).slice(0, 3);
    if (fr.classPlaces.join() !== want.join()) assert.fail(`${label}: classPlaces ${fr.classPlaces} ≠ ${want}`);
    const inSF = ms.some((m) => m.stage === 'sf' && (m.team_a === T || m.team_b === T));
    if (fr.teachersAward !== (inSF ? 'honor' : 'special')) assert.fail(`${label}: teachersAward ${fr.teachersAward}`);
  }
  const setKO = (s, mask) => { for (let i = 0; i < 8; i++) setResult(s, 13 + i, (mask >> i) & 1 ? 7 : 13, (mask >> i) & 1 ? 13 : 7); };

  test('all 6^4 group finishing orders: quarterfinals = top two of each group, never same-group', () => {
    let n = 0;
    for (const pa of PERMS) for (const pb of PERMS) for (const pv of PERMS) for (const pg of PERMS) {
      const orders = { A: pa, B: pb, V: pv, G: pg };
      const s = playAllGroups(makeState(), orders);
      const ms = L.resolveMatches(s);
      const top = (g, place) => SEAT[`${g}${orders[g][place - 1]}`];
      const want = [[top('A', 1), top('B', 2)], [top('B', 1), top('A', 2)], [top('V', 1), top('G', 2)], [top('G', 1), top('V', 2)]];
      assert.deepEqual([13, 14, 15, 16].map((no) => pair(ms, no)), want);
      for (const [a, b] of want) assert.notEqual(groupOf.get(a), groupOf.get(b));
      n += 1;
    }
    assert.equal(n, 1296);
  });

  test('all 2^8 knockout outcomes × every uniform group order, plus 3 000 sampled from the full product', () => {
    for (const p of PERMS) {
      const s = playAllGroups(makeState(), { A: p, B: p, V: p, G: p });
      for (let mask = 0; mask < 256; mask++) { setKO(s, mask); check(s, `perm ${p} mask ${mask}`); }
    }
    const rnd = mulberry32(2026);
    for (let i = 0; i < 3000; i++) {
      const orders = Object.fromEntries(GROUPS.map((g) => [g, PERMS[Math.floor(rnd() * 6)]]));
      const s = playAllGroups(makeState(), orders);
      const mask = Math.floor(rnd() * 256);
      setKO(s, mask);
      check(s, `sample ${i}`);
    }
    assert.ok(met.final > 0 && met.third > 0, 'same-group final and 3rd-place meetings do occur');
  });

  test('complete enumeration 6^4 × 2^8 = 331 776 brackets (FULL_ENUM=1)', { skip: !process.env.FULL_ENUM }, () => {
    let n = 0;
    for (const pa of PERMS) for (const pb of PERMS) for (const pv of PERMS) for (const pg of PERMS) {
      const s = playAllGroups(makeState(), { A: pa, B: pb, V: pv, G: pg });
      for (let mask = 0; mask < 256; mask++) { setKO(s, mask); check(s, `${pa}|${pb}|${pv}|${pg} mask ${mask}`); n += 1; }
    }
    assert.equal(n, 331776);
  });
});

// ================================================================ team schedule
describe('teamSchedule', () => {
  test('nothing before the draw; two group matches after it', () => {
    assert.deepEqual(L.teamSchedule(makeState({ drawStatus: 'committed' }), 4), []);
    assert.deepEqual(L.teamSchedule(makeState(), 4).map((m) => m.no), [1, 5]);
    assert.deepEqual(L.teamSchedule(makeState(), '4').map((m) => m.no), [1, 5]);
    assert.deepEqual(L.teamSchedule(makeState(), ID['8v']).map((m) => m.no), [6, 10]);
    assert.deepEqual(L.teamSchedule(makeState(), 999), []);
    assert.deepEqual(L.teamSchedule(makeState(), null), []);
    assert.deepEqual(L.teamSchedule(null, 4), []);
  });

  test('sorted by the (possibly moved) start time, then match number', () => {
    const s = makeState();
    match(s, 1).start = '2026-10-24T16:45:00+08:00'; // moved to the reserve slot
    assert.deepEqual(L.teamSchedule(s, 4).map((m) => m.no), [5, 1]);
    match(s, 1).start = match(s, 5).start;
    assert.deepEqual(L.teamSchedule(s, 4).map((m) => m.no), [1, 5]);
    const v = playAllGroups(makeState());
    match(v, 7).start = '2026-10-25T08:30:00+08:00'; // Day 2 reserve wave (В/Г only)
    assert.deepEqual(L.teamSchedule(v, 3).map((m) => [m.no, m.start.slice(5, 16)]),
      [[3, '10-24T10:45'], [7, '10-25T08:30'], [15, '10-25T10:45']]);
  });

  test('a champion path: group → 1/4 → 1/2 → final', () => {
    const s = playKO(playAllGroups(makeState()), { 13: 'a', 14: 'a', 15: 'a', 16: 'a', 17: 'a', 18: 'a', 19: 'a', 20: 'a' });
    assert.deepEqual(L.teamSchedule(s, 4).map((m) => m.no), [1, 5, 13, 17, 19]);
    assert.deepEqual(L.teamSchedule(s, 3).map((m) => m.no), [3, 7, 15, 17, 20]);
    const times = L.teamSchedule(s, 4).map((m) => Date.parse(m.start));
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
  });
});

// ================================================================ SPEC v6: public pages (people, places)
// Public-UI sources only (content fragments, public page modules, shell, public CSS). No DOM: plain text checks.
describe('SPEC v6: public pages — people and places', () => {
  const DOCS = new URL('../docs/', import.meta.url);
  const read = (rel) => readFileSync(new URL(rel, DOCS), 'utf8').normalize('NFC');
  const PAGES = ['home', 'rules', 'schedule', 'groups', 'bracket', 'faq', 'downloads', 'privacy', 'draw', 'tv'].map((p) => `js/pages/${p}.js`);
  const CONTENT = ['home', 'rules', 'faq', 'privacy'].map((p) => `content/${p}.html`);
  const PUBLIC = [...CONTENT, ...PAGES, 'index.html', '404.html', 'css/public.css', 'css/app.css'];
  const noComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  test('config.js STAFF and PLACES hold the SPEC v6 people and places', async () => {
    const { STAFF, PLACES, CONTACT_NAME, CONTACT_PHONES } = await import('../docs/js/config.js');
    assert.deepEqual({ ...STAFF, it: [...STAFF.it] }, {
      director: 'Д.Бямбасамбуу', lead: 'Г.Жаргал', organiser: 'А.Мөнгөншагай',
      it: ['А.Мөнгөншагай', 'Б.Даваа', 'Д.Мажигсүрэн'], social: 'Г.Энхнаран',
    });
    assert.equal(CONTACT_NAME, STAFF.organiser);
    assert.deepEqual([...CONTACT_PHONES], ['60114971', '94741053']);
    assert.deepEqual({ ...PLACES }, { lab: 'Windows lab', hall: 'Урлагийн заал' });
  });

  test('no committee, accountant, waiting room, projector, old titles, removed v5 wording or [placeholders]', () => {
    const BAD = [
      ['committee «хороо»', /хороо/iu],
      ['accountant', /нягтлан/iu],
      ['old title «мэдээлэл зүйн багш»', /мэдээлэл\s+зүйн\s+багш/iu],
      ['waiting room', /хүлээлгийн\s+өрөө/iu],
      ['projector', /проектор/iu],
      ['placeholder', /\[(?:Захирлын овог нэр|Сургалтын менежерийн нэр|Мэдээлэл зүйн багшийн нэр|Нийгмийн ажилтны нэр|Нягтлан бодогчийн нэр|Лабын тоот|Танхимын нэр|Өрөөний тоот|Хот, дүүрэг|Утас|Овог нэр|И-мэйл)\]/u],
      ['removed v5 wording', /Ангийн\s+аварга|төлбөргүй|хураамжгүй|батламж|Шударга\s+тоглолт|Шилдэг\s+тайлбарлагч|Бэлэн\s+мөнгө|10\.16\s*\(Ба\)\s*17:00|10\.21\s*\(Лх\)\s*17:00/iu],
      ['old budget totals', /2(?:\s|&nbsp;)333(?:\s|&nbsp;)100|1(?:\s|&nbsp;)838(?:\s|&nbsp;)100|2(?:\s|&nbsp;)121(?:\s|&nbsp;)000/u],
      // SPEC v7 §0c.5: old money — fund 1 200 000, 1st 600 000, fee total 1 320 000, «11 × 120 000», teachers' team exempt
      ['v7: old prize / fee amounts', /1(?:\s|&nbsp;)200(?:\s|&nbsp;)000|1(?:\s|&nbsp;)320(?:\s|&nbsp;)000|600(?:\s|&nbsp;)000|11(?:\s|&nbsp;)*×/u],
      ['v7: teachers\' team exempt from the fee', /хураамж(?:\s|&nbsp;)+төлөхгүй|хураамж:(?:\s|&nbsp;)+хамаарахгүй/iu],
      ['v7: old MVP cash 100 000', /MVP[^.\n<]{0,40}100(?:\s|&nbsp;)000/u],
    ];
    for (const rel of PUBLIC) {
      const src = read(rel);
      for (const [label, re] of BAD) assert.doesNotMatch(src, re, `${rel}: ${label}`);
    }
  });

  test('SPEC v7 money everywhere in docs/ (admin, class page, print, lobby screen too): no old amounts, no fee exemption', () => {
    const files = [];
    const walk = (rel) => {
      for (const e of readdirSync(new URL(rel, DOCS), { withFileTypes: true })) {
        const r = `${rel}${e.name}`;
        if (e.isDirectory()) { if (e.name !== 'vendor' && e.name !== 'assets' && e.name !== 'fonts') walk(`${r}/`); }
        else if (/\.(?:js|html|css)$/.test(e.name)) files.push(r);
      }
    };
    walk('');
    assert.ok(files.includes('js/pages/screen.js') && files.includes('js/admin/util.js') && files.includes('index.html'));
    const MONEY = [
      ['old fund / 1st place / fee total', /1(?:\s|&nbsp;|\\u00A0)200(?:\s|&nbsp;|\\u00A0)000|1(?:\s|&nbsp;|\\u00A0)320(?:\s|&nbsp;|\\u00A0)000|600(?:\s|&nbsp;|\\u00A0)000|\b1[23]00000\b|\b600000\b/u],
      ['«11 × 120 000»', /11(?:\s|&nbsp;)*×/u],
      ['teachers\' team exempt from the fee', /хураамж(?:\s|&nbsp;)+төлөхгүй|хураамж:(?:\s|&nbsp;)+хамаарахгүй/iu],
      ['fund + MVP cash (MVP is inside the fund since v7)', /PRIZES\.fund\)?\s*\}?\s*\+\s*(?:MVP|\$?\{?\s*\w*\(?PRIZES\.mvp_cash)/u],
    ];
    for (const rel of files) {
      const src = read(rel);
      for (const [label, re] of MONEY) assert.doesNotMatch(src, re, `${rel}: ${label}`);
    }
  });

  test('names come from config.js: the director is never shown; page modules import STAFF / PLACES', async () => {
    const { STAFF, PLACES } = await import('../docs/js/config.js');
    for (const rel of PUBLIC) assert.ok(!read(rel).includes(STAFF.director), `${rel} names the director`);
    for (const rel of PAGES) {
      const src = noComments(read(rel));
      for (const v of [STAFF.lead, STAFF.organiser, STAFF.social, ...STAFF.it, PLACES.lab, PLACES.hall]) {
        assert.ok(!src.includes(v), `${rel} hard-codes «${v}» — import STAFF / PLACES from config.js`);
      }
    }
  });

  test('content fragments: every data-cfg key exists and its fallback text equals the config value', async () => {
    const { CFG } = await import('../docs/js/pages/rules.js');
    let n = 0;
    for (const rel of CONTENT) {
      for (const m of read(rel).matchAll(/<(\w+)\b[^>]*\bdata-cfg="([A-Z_]+)"[^>]*>([^<]*)<\/\1>/g)) {
        n += 1;
        assert.ok(Object.hasOwn(CFG, m[2]), `${rel}: unknown data-cfg key ${m[2]}`);
        assert.equal(m[3], CFG[m[2]], `${rel}: fallback text of data-cfg="${m[2]}"`);
      }
    }
    assert.ok(n >= 20, `expected the people/places spans in the fragments, found ${n}`);
  });

  test('rules: 12 numbered cards incl. «Өөрийн хэрэгсэл» and «Зохион байгуулалт»; FAQ count matches the home link', () => {
    const rules = read('content/rules.html');
    const ids = [...rules.matchAll(/<article class="card rl-card" id="(rl-[a-z0-9-]+)">\s*<h2><span class="rl-n">(\d+)<\/span>/g)];
    assert.equal(ids.length, 12);
    assert.deepEqual(ids.map((m) => Number(m[2])), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const id of ['rl-gear', 'rl-org', 'rl-fee', 'rl-time']) assert.ok(ids.some((m) => m[1] === id), id);
    const faq = (read('content/faq.html').match(/<details>/g) || []).length;
    const link = read('js/pages/home.js').match(/'(\d+) асуулт'/);
    assert.ok(link, 'home links show the FAQ count');
    assert.equal(Number(link[1]), faq);
  });
});
