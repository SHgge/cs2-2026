// Tests for docs/js/phase.js — the lobby screen #/screen (phase, slide rotation, right-rail countdown) — and a text
// guard over the screen sources (screen.js, phase.js, screen.css). Run: npm test. Synthetic data only.
// Every instant is written with an explicit +08:00 offset, so nothing depends on the machine's time zone.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SLIDE_IDS, SLIDE_LABEL, TIMES, settingsOf, finished, drawShown, regSummary, screenPhase, wavesOf, slidesFor, countdownFor,
} from '../docs/js/phase.js';
import { DATES, DRAW_AT, MATCHES, DAY_INFO, TEAMS } from '../docs/js/event.js';
import { makeState, setResult } from './fixtures.mjs';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
/** Ulaanbaatar wall clock '2026-10-23T23:59:58' → ISO with offset / → ms. */
const iso = (local) => `${local}+08:00`;
const at = (local) => Date.parse(iso(local));
const d1 = (hm) => iso(`2026-10-24T${hm}:00`);
const d2 = (hm) => iso(`2026-10-25T${hm}:00`);
const STATION = Object.fromEntries(MATCHES.map((m) => [m.no, m.station]));

/** Registration-week state: registration open, draw `draw` (none by default), nobody registered yet. */
function regState({ draw = 'none', settings = {} } = {}) {
  const s = makeState({ drawStatus: draw });
  Object.assign(s.settings, { registration_open: true }, settings);
  for (const t of s.teams) t.reg = { players: 0, confirmed: false, consents: 0 };
  return s;
}

/** Event state (fixture: registration closed, draw published) with the final (19) and the 3rd-place match (20) at these statuses. */
function endState(s19 = 'final', s20 = 'final') {
  const s = makeState();
  setResult(s, 19, 13, 9, { status: s19 });
  setResult(s, 20, 13, 11, { status: s20 });
  return s;
}

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
};

/** One line per countdown: 'phase mode | label | start | target | matches'. */
const brief = (c) => `${c.phase} ${c.mode} | ${c.label} | ${c.start || '-'} | ${c.target || '-'} | ${c.matches ? c.matches.join(',') : '-'}`;

const NEXT = 'Дараагийн тоглолт хүртэл';
const LIVE = 'Одоо тоглож байна';
const QF = 'Шөвгийн 8 эхлэх хүртэл';
const AWARDS = 'Шагнал гардуулах хүртэл';
const CHIP = 'Өнөөдөр 16:00 — хэсгийн сугалаа';
const REG = ['hero', 'race', 'prize', 'join', 'fee', 'req', 'gear', 'teachers', 'format', 'dates'];
const CLOSED = ['kickoff', 'day1', 'day2', 'prize', 'rules', 'gear', 'watch'];
const LIVE_ONLY = new Set(['race', 'live']);

// ================================================================ constants
describe('phase.js constants', () => {
  test('SLIDE_IDS: 21 unique URL-safe ids, each with a label; frozen', () => {
    assert.equal(SLIDE_IDS.length, 21);
    assert.equal(new Set(SLIDE_IDS).size, 21);
    assert.deepEqual(Object.keys(SLIDE_LABEL).sort(), [...SLIDE_IDS].sort());
    for (const id of SLIDE_IDS) {
      assert.match(id, /^[a-z0-9]+$/, id);                     // used in ?slide=<id> and data-slide
      const l = SLIDE_LABEL[id];
      assert.ok(typeof l === 'string' && l.length > 0 && l === l.trim(), `${id}: «${l}»`);
    }
    assert.ok(Object.isFrozen(SLIDE_IDS) && Object.isFrozen(SLIDE_LABEL) && Object.isFrozen(TIMES));
  });

  test('TIMES agree with event.js (SPEC v5 §7)', () => {
    for (const v of Object.values(TIMES)) assert.match(v, /^2026-10-2[45]T\d\d:\d\d:00\+08:00$/);
    const order = ['day1Open', 'day1Start', 'day1End', 'day2Open', 'day2First', 'awards', 'day2End'];
    for (let i = 1; i < order.length; i++) assert.ok(Date.parse(TIMES[order[i - 1]]) < Date.parse(TIMES[order[i]]), order[i]);
    assert.deepEqual([TIMES.day1Open, TIMES.day1Start, TIMES.day1End], [d1('07:00'), d1('09:00'), d1('18:00')]);
    assert.deepEqual([TIMES.day2Open, TIMES.day2First, TIMES.awards, TIMES.day2End], [d2('07:00'), d2('09:30'), d2('16:15'), d2('18:00')]);
    assert.ok(DAY_INFO.d1.some(([hm, label]) => hm === '09:00' && /Нээлт/.test(label)));
    assert.ok(DAY_INFO.d2.some(([hm, label]) => hm === '16:15' && /Шагнал/.test(label)));
    assert.equal(TIMES.day2First, wavesOf(2)[0].start);
    assert.ok(Date.parse(wavesOf(1).at(-1).end) <= Date.parse(TIMES.day1End));
    assert.ok(Date.parse(wavesOf(2).at(-1).end) <= Date.parse(TIMES.awards));
    assert.equal(DATES.reg_closes_at, iso('2026-10-23T23:59:59'));
    assert.equal(DATES.fee_due_at, iso('2026-10-23T17:00:00'));
    assert.equal(DRAW_AT, iso('2026-10-22T16:00:00'));
  });
});

// ================================================================ settingsOf / finished / drawShown
describe('settingsOf', () => {
  const DEF = { reg: DATES.reg_closes_at, consent: DATES.consent_deadline_at, fee: DATES.fee_due_at, draw: DRAW_AT, open: true, stream: null };

  test('defaults from event.js when the state has no settings', () => {
    for (const st of [null, undefined, {}, { settings: null }, { settings: {} }]) assert.deepEqual(settingsOf(st), DEF);
  });

  test('valid live values win (incl. the RPC formats: other offset, fractions)', () => {
    const s = settingsOf({ settings: {
      reg_closes_at: iso('2026-10-23T20:00:00'), consent_deadline_at: iso('2026-10-23T12:00:00'),
      registration_open: false, stream_url: 'https://www.facebook.com/OctolearnLondonSchool/live',
    } });
    assert.deepEqual(s, { ...DEF, reg: iso('2026-10-23T20:00:00'), consent: iso('2026-10-23T12:00:00'), open: false,
      stream: 'https://www.facebook.com/OctolearnLondonSchool/live' });
    assert.equal(settingsOf({ settings: { reg_closes_at: '2026-10-23T15:59:59+00:00' } }).reg, '2026-10-23T15:59:59+00:00');
    assert.equal(settingsOf({ settings: { reg_closes_at: '2026-10-23T23:59:59.185744+08:00' } }).reg, '2026-10-23T23:59:59.185744+08:00');
  });

  test('invalid ISO values are ignored', () => {
    for (const bad of ['garbage', '', '   ', '2026-10-23T25:61:00+08:00', '2026-13-01T00:00:00+08:00', null, undefined,
      Date.parse(DATES.reg_closes_at), true, {}, []]) {
      const s = settingsOf({ settings: { reg_closes_at: bad, consent_deadline_at: bad } });
      assert.equal(s.reg, DATES.reg_closes_at, JSON.stringify(bad));
      assert.equal(s.consent, DATES.consent_deadline_at, JSON.stringify(bad));
    }
  });

  test('fee and draw times are fixed — never from settings or roster_freeze_at', () => {
    const s = settingsOf({ settings: {
      fee_due_at: iso('2026-10-20T10:00:00'), draw_at: iso('2026-10-20T10:00:00'), roster_freeze_at: iso('2026-10-21T16:00:00'),
    } });
    assert.equal(s.fee, DATES.fee_due_at);
    assert.equal(s.draw, DRAW_AT);
  });

  test('registration_open: only an explicit false closes', () => {
    assert.equal(settingsOf({ settings: { registration_open: false } }).open, false);
    for (const v of [true, null, undefined]) assert.equal(settingsOf({ settings: { registration_open: v } }).open, true, String(v));
  });

  test('stream_url: https only, no whitespace', () => {
    for (const u of ['https://www.facebook.com/OctolearnLondonSchool/live', 'https://fb.watch/abc123/']) {
      assert.equal(settingsOf({ settings: { stream_url: u } }).stream, u);
    }
    for (const u of ['http://www.facebook.com/x', 'javascript:alert(1)', 'https://', 'https:// x.mn', ' https://x.mn',
      'https://x.mn\n', 'https://x.mn/a b', 'ftp://x.mn', '//x.mn', 'data:text/html,hi', 42, null, undefined, {}]) {
      assert.equal(settingsOf({ settings: { stream_url: u } }).stream, null, JSON.stringify(u));
    }
  });
});

describe('finished / drawShown', () => {
  test('finished(): the final (19) and the 3rd-place match (20) are both official', () => {
    assert.equal(finished(endState()), true);
    for (const [a, b] of [['final', 'reported'], ['reported', 'final'], ['live', 'live'], ['final', 'scheduled']]) {
      assert.equal(finished(endState(a, b)), false, `${a}/${b}`);
    }
    assert.equal(finished(makeState()), false);
    const missing = endState();
    missing.matches = missing.matches.filter((m) => m.no !== 20);
    assert.equal(finished(missing), false);
    const others = endState();
    for (const m of others.matches) if (m.no < 19) m.status = 'scheduled';
    assert.equal(finished(others), true);
    for (const st of [null, undefined, {}, { matches: 'x' }, { matches: [null] }]) assert.equal(finished(st), false);
  });

  test('drawShown(): only a published draw with groups', () => {
    assert.equal(drawShown(makeState()), true);
    for (const st of ['none', 'committed', 'computed']) assert.equal(drawShown(makeState({ drawStatus: st })), false, st);
    const noGroups = makeState();
    noGroups.draw.groups = null;
    assert.equal(drawShown(noGroups), false);
    for (const st of [null, undefined, {}, { draw: null }]) assert.equal(drawShown(st), false);
  });
});

// ================================================================ screenPhase
describe('screenPhase', () => {
  test('reg until reg_closes_at (10.23 23:59:59), then closed — also without any state', () => {
    for (const st of [regState(), null, {}]) {
      assert.equal(screenPhase(at('2026-10-19T08:00:00'), st), 'reg');
      assert.equal(screenPhase(at('2026-10-23T23:59:58'), st), 'reg');
      assert.equal(screenPhase(at('2026-10-23T23:59:59') - 1, st), 'reg');
      assert.equal(screenPhase(at('2026-10-23T23:59:59'), st), 'closed');
      assert.equal(screenPhase(at('2026-10-24T03:00:00'), st), 'closed');
    }
  });

  test('registration_open:false closes at once; reg_closes_at from settings moves the boundary', () => {
    const off = regState({ settings: { registration_open: false } });
    assert.equal(screenPhase(at('2026-10-19T08:00:00'), off), 'closed');
    assert.equal(screenPhase(at('2026-10-23T12:00:00'), off), 'closed');
    const early = regState({ settings: { reg_closes_at: iso('2026-10-23T20:00:00') } });
    assert.equal(screenPhase(at('2026-10-23T19:59:59'), early), 'reg');
    assert.equal(screenPhase(at('2026-10-23T20:00:00'), early), 'closed');
    const bad = regState({ settings: { reg_closes_at: 'garbage' } });      // invalid → DATES fallback
    assert.equal(screenPhase(at('2026-10-23T23:59:58'), bad), 'reg');
    assert.equal(screenPhase(at('2026-10-23T23:59:59'), bad), 'closed');
    // the event days win over a (mis)configured late registration close
    const late = regState({ settings: { reg_closes_at: iso('2026-10-24T08:00:00') } });
    assert.equal(screenPhase(at('2026-10-24T06:59:59'), late), 'reg');
    assert.equal(screenPhase(at('2026-10-24T07:00:00'), late), 'day1');
  });

  test('10.24 06:59 closed → 07:00 day1 → 18:00 night → 10.25 07:00 day2 → 18:00 over', () => {
    const rows = [
      ['2026-10-24T06:59:00', 'closed'], ['2026-10-24T06:59:59', 'closed'], ['2026-10-24T07:00:00', 'day1'],
      ['2026-10-24T12:00:00', 'day1'], ['2026-10-24T17:59:59', 'day1'], ['2026-10-24T18:00:00', 'night'],
      ['2026-10-25T06:59:59', 'night'], ['2026-10-25T07:00:00', 'day2'], ['2026-10-25T16:05:00', 'day2'],
      ['2026-10-25T17:59:59', 'day2'], ['2026-10-25T18:00:00', 'over'], ['2026-10-26T09:00:00', 'over'],
    ];
    for (const st of [makeState(), regState(), null]) {
      for (const [t, p] of rows) assert.equal(screenPhase(at(t), st), p, t);
    }
  });

  test('over as soon as the final and the 3rd-place match are official (16:05), never before 10.25 07:00', () => {
    const t = at('2026-10-25T16:05:00');
    assert.equal(screenPhase(t, endState()), 'over');
    for (const [a, b] of [['final', 'reported'], ['reported', 'final'], ['live', 'live']]) {
      assert.equal(screenPhase(t, endState(a, b)), 'day2', `${a}/${b}`);
    }
    assert.equal(screenPhase(t, makeState()), 'day2');
    assert.equal(screenPhase(at('2026-10-24T12:00:00'), endState()), 'day1');    // stale data cannot end day 1 …
    assert.equal(screenPhase(at('2026-10-24T20:00:00'), endState()), 'night');   // … or the night
  });
});

// ================================================================ slidesFor
describe('slidesFor', () => {
  test('reg: race only live; groups (before dates) only after the draw is published', () => {
    const t = at('2026-10-20T10:00:00');
    assert.deepEqual(slidesFor(t, regState()), REG);
    assert.deepEqual(slidesFor(t, regState(), {}), REG);
    assert.deepEqual(slidesFor(t, regState(), { live: true }), REG);
    assert.deepEqual(slidesFor(t, regState(), { live: false }), REG.filter((id) => id !== 'race'));
    for (const d of ['none', 'committed', 'computed']) {
      assert.ok(!slidesFor(at('2026-10-22T16:30:00'), regState({ draw: d })).includes('groups'), d);
    }
    const pub = regState({ draw: 'published' });
    const t2 = at('2026-10-22T16:30:00');
    assert.deepEqual(slidesFor(t2, pub), ['hero', 'race', 'prize', 'join', 'fee', 'req', 'gear', 'teachers', 'format', 'groups', 'dates']);
    assert.deepEqual(slidesFor(t2, pub, { live: false }), ['hero', 'prize', 'join', 'fee', 'req', 'gear', 'teachers', 'format', 'groups', 'dates']);
    pub.draw.groups = null;
    assert.ok(!slidesFor(t2, pub).includes('groups'));
  });

  test('closed: kickoff, groups after the draw, the two days, prize, rules, gear, watch', () => {
    const t = at('2026-10-24T02:00:00');
    assert.deepEqual(slidesFor(t, makeState({ drawStatus: 'none' })), CLOSED);
    assert.deepEqual(slidesFor(t, makeState({ drawStatus: 'computed' })), CLOSED);
    const withGroups = ['kickoff', 'groups', ...CLOSED.slice(1)];
    assert.deepEqual(slidesFor(t, makeState()), withGroups);
    assert.deepEqual(slidesFor(t, makeState(), { live: false }), withGroups);
    assert.deepEqual(slidesFor(at('2026-10-21T10:00:00'), regState({ settings: { registration_open: false } })), CLOSED);
  });

  test('day1 / night / day2 / over; live=false drops the live board', () => {
    const st = makeState();
    const rows = [
      ['2026-10-24T10:00:00', ['live', 'standings', 'live', 'day1', 'prize', 'watch'], ['standings', 'day1', 'prize', 'watch']],
      ['2026-10-24T20:00:00', ['standings', 'day2', 'prize', 'watch'], ['standings', 'day2', 'prize', 'watch']],
      ['2026-10-25T11:00:00', ['live', 'bracket', 'live', 'day2', 'prize', 'watch'], ['bracket', 'day2', 'prize', 'watch']],
      ['2026-10-25T18:00:00', ['champion', 'bracket', 'thanks'], ['champion', 'bracket', 'thanks']],
    ];
    for (const [t, live, still] of rows) {
      assert.deepEqual(slidesFor(at(t), st), live, t);
      assert.deepEqual(slidesFor(at(t), st, { live: false }), still, t);
    }
    assert.deepEqual(slidesFor(at('2026-10-25T16:05:00'), endState()), ['champion', 'bracket', 'thanks']);
  });
});

// ================================================================ own-gear slide (SPEC v6 §0b.6)
describe('gear slide (own mouse, keyboard, headset)', () => {
  const after = (list, id) => list[list.indexOf(id) + 1];

  test('id, label and place in SLIDE_IDS (right after req)', () => {
    assert.equal(SLIDE_LABEL.gear, 'Өөрийн хэрэгсэл');
    assert.equal(SLIDE_IDS.indexOf('gear'), SLIDE_IDS.indexOf('req') + 1);
  });

  test('reg: once, right after req and before teachers — live and static, before and after the draw', () => {
    const rows = [[regState(), '2026-10-19T08:00:00'], [regState(), '2026-10-22T10:00:00'],
      [regState({ draw: 'published' }), '2026-10-22T17:30:00'], [regState({ draw: 'published' }), '2026-10-23T23:59:58']];
    for (const [s, t] of rows) {
      for (const live of [true, false]) {
        const list = slidesFor(at(t), s, { live });
        assert.equal(list.filter((id) => id === 'gear').length, 1, `${t} live=${live}`);
        assert.equal(list[list.indexOf('req') + 1], 'gear', `${t} live=${live}`);
        assert.equal(after(list, 'gear'), 'teachers', `${t} live=${live}`);
      }
    }
  });

  test('closed: once, right after rules and before watch — with and without groups', () => {
    const rows = [[makeState({ drawStatus: 'none' }), '2026-10-24T02:00:00'], [makeState(), '2026-10-24T05:00:00'],
      [makeState(), '2026-10-24T06:59:59'], [regState({ settings: { registration_open: false } }), '2026-10-21T10:00:00']];
    for (const [s, t] of rows) {
      for (const live of [true, false]) {
        const list = slidesFor(at(t), s, { live });
        assert.equal(list.filter((id) => id === 'gear').length, 1, `${t} live=${live}`);
        assert.equal(list[list.indexOf('rules') + 1], 'gear', `${t} live=${live}`);
        assert.equal(after(list, 'gear'), 'watch', `${t} live=${live}`);
      }
    }
  });

  test('event days, the night and after the event: no gear slide (the rest of the API is unchanged)', () => {
    const s = makeState();
    for (const t of ['2026-10-24T07:00:00', '2026-10-24T12:00:00', '2026-10-24T20:00:00', '2026-10-25T11:00:00', '2026-10-25T18:00:00']) {
      for (const live of [true, false]) assert.ok(!slidesFor(at(t), s, { live }).includes('gear'), `${t} live=${live}`);
    }
    assert.ok(!slidesFor(at('2026-10-25T16:05:00'), endState()).includes('gear'));
    // dropping 'gear' gives back the v5 lists exactly
    assert.deepEqual(REG.filter((id) => id !== 'gear'), ['hero', 'race', 'prize', 'join', 'fee', 'req', 'teachers', 'format', 'dates']);
    assert.deepEqual(CLOSED.filter((id) => id !== 'gear'), ['kickoff', 'day1', 'day2', 'prize', 'rules', 'watch']);
  });
});

// ================================================================ wavesOf
describe('wavesOf', () => {
  const fmt = (w) => `${w.start.slice(11, 16)}-${w.end.slice(11, 16)}:${w.nos.join(',')}`;

  test('day 1: 6 group waves; day 2: 4 knockout waves; each = one match on station А + one on Б', () => {
    const w1 = wavesOf(1);
    const w2 = wavesOf(2);
    assert.equal(w1.length, 6);
    assert.equal(w2.length, 4);
    assert.deepEqual(w1.map(fmt), ['09:45-10:45:1,2', '10:45-11:45:3,4', '11:45-12:45:5,6', '13:45-14:45:7,8', '14:45-15:45:9,10', '15:45-16:45:11,12']);
    assert.deepEqual(w2.map(fmt), ['09:30-10:45:13,14', '10:45-12:00:15,16', '13:00-14:15:17,18', '14:45-16:00:19,20']);
    assert.ok(w1.every((w) => w.start.startsWith('2026-10-24')) && w2.every((w) => w.start.startsWith('2026-10-25')));
    for (const w of [...w1, ...w2]) assert.deepEqual(w.nos.map((no) => STATION[no]).sort(), ['A', 'B'], fmt(w));
    for (const ws of [w1, w2]) for (let i = 1; i < ws.length; i++) assert.ok(Date.parse(ws[i - 1].end) <= Date.parse(ws[i].start));
    assert.deepEqual([...w1, ...w2].flatMap((w) => w.nos).sort((a, b) => a - b), MATCHES.map((m) => m.no));
    assert.deepEqual(wavesOf(3), []);
    w1[0].nos.push(99);                                     // fresh objects every call
    assert.deepEqual(wavesOf(1)[0].nos, [1, 2]);
  });
});

// ================================================================ countdownFor
describe('countdownFor', () => {
  test('reg: counts to reg_closes_at — settings first, else DATES', () => {
    const t = at('2026-10-20T10:00:00');
    const c = countdownFor(t, regState());
    assert.equal(c.phase, 'reg');
    assert.equal(c.mode, 'countdown');
    assert.equal(c.label, 'Онлайн бүртгэл хаагдах хүртэл');
    assert.equal(c.target, DATES.reg_closes_at);
    assert.equal(countdownFor(t, null).target, DATES.reg_closes_at);
    assert.equal(countdownFor(t, regState({ settings: { reg_closes_at: 'garbage' } })).target, DATES.reg_closes_at);
    assert.equal(countdownFor(t, regState({ settings: { reg_closes_at: iso('2026-10-23T20:00:00') } })).target, iso('2026-10-23T20:00:00'));
  });

  test('reg: «Хураамж, зөвшөөрөл» line until 10.23 17:00', () => {
    const s = regState();
    const sub = { label: 'Хураамж, зөвшөөрөл', at: DATES.fee_due_at };
    assert.deepEqual(countdownFor(at('2026-10-19T08:00:00'), s).sub, sub);
    assert.deepEqual(countdownFor(at('2026-10-23T16:59:59'), s).sub, sub);
    assert.equal(countdownFor(at('2026-10-23T17:00:00'), s).sub, null);
    assert.equal(countdownFor(at('2026-10-23T23:00:00'), s).sub, null);
  });

  test('reg: draw chip only on 10.22 before 16:00 (Ulaanbaatar day)', () => {
    const s = regState();
    const chip = (t) => countdownFor(at(t), s).chip;
    assert.equal(chip('2026-10-21T23:59:59'), null);
    assert.equal(chip('2026-10-22T00:00:00'), CHIP);       // = 10.21 16:00 UTC
    assert.equal(chip('2026-10-22T07:59:59'), CHIP);
    assert.equal(chip('2026-10-22T15:59:59'), CHIP);
    assert.equal(chip('2026-10-22T16:00:00'), null);
    assert.equal(chip('2026-10-23T10:00:00'), null);
    const freeze = regState({ settings: { roster_freeze_at: iso('2026-10-21T16:00:00') } });
    assert.equal(countdownFor(at('2026-10-21T10:00:00'), freeze).chip, null);   // the draw is never roster_freeze_at
  });

  test('reg: urgent only in the last 24 h', () => {
    const s = regState();
    assert.equal(countdownFor(at('2026-10-19T08:00:00'), s).urgent, false);
    assert.equal(countdownFor(at('2026-10-22T23:59:59'), s).urgent, false);    // exactly 24 h left
    assert.equal(countdownFor(at('2026-10-23T00:00:00'), s).urgent, true);
    assert.equal(countdownFor(at('2026-10-23T23:59:58'), s).urgent, true);
    const early = regState({ settings: { reg_closes_at: iso('2026-10-23T20:00:00') } });
    assert.equal(countdownFor(at('2026-10-22T20:00:00'), early).urgent, false);
    assert.equal(countdownFor(at('2026-10-22T20:00:01'), early).urgent, true);
  });

  test('closed: counts to the opening 10.24 09:00', () => {
    const want = { phase: 'closed', mode: 'countdown', label: 'Тэмцээн эхлэх хүртэл', target: d1('09:00'), sub: null, chip: null, urgent: false };
    for (const t of ['2026-10-23T23:59:59', '2026-10-24T06:59:59']) assert.deepEqual(countdownFor(at(t), makeState()), want, t);
    assert.deepEqual(countdownFor(at('2026-10-20T10:00:00'), regState({ settings: { registration_open: false } })), want);
  });

  test('day 1: next wave, live wave bar, lunch gap, evening → day-2 quarterfinals', () => {
    const s = makeState();
    const rows = [
      ['07:00:00', `day1 countdown | ${NEXT} | - | ${d1('09:45')} | 1,2`],
      ['09:44:59', `day1 countdown | ${NEXT} | - | ${d1('09:45')} | 1,2`],
      ['09:45:00', `day1 live | ${LIVE} | ${d1('09:45')} | ${d1('10:45')} | 1,2`],
      ['10:44:59', `day1 live | ${LIVE} | ${d1('09:45')} | ${d1('10:45')} | 1,2`],
      ['10:45:00', `day1 live | ${LIVE} | ${d1('10:45')} | ${d1('11:45')} | 3,4`],
      ['12:44:59', `day1 live | ${LIVE} | ${d1('11:45')} | ${d1('12:45')} | 5,6`],
      ['12:45:00', `day1 countdown | ${NEXT} | - | ${d1('13:45')} | 7,8`],
      ['13:45:00', `day1 live | ${LIVE} | ${d1('13:45')} | ${d1('14:45')} | 7,8`],
      ['15:00:00', `day1 live | ${LIVE} | ${d1('14:45')} | ${d1('15:45')} | 9,10`],
      ['16:44:59', `day1 live | ${LIVE} | ${d1('15:45')} | ${d1('16:45')} | 11,12`],
      ['16:45:00', `day1 countdown | ${QF} | - | ${d2('09:30')} | -`],
      ['17:59:59', `day1 countdown | ${QF} | - | ${d2('09:30')} | -`],
    ];
    for (const [hms, want] of rows) assert.equal(brief(countdownFor(at(`2026-10-24T${hms}`), s)), want, hms);
  });

  test('night: counts to the quarterfinals 10.25 09:30', () => {
    const want = { phase: 'night', mode: 'countdown', label: QF, target: d2('09:30'), sub: null, chip: null, urgent: false };
    for (const t of ['2026-10-24T18:00:00', '2026-10-25T06:59:59']) assert.deepEqual(countdownFor(at(t), makeState()), want, t);
  });

  test('day 2: waves, then the awards 16:15, then nothing', () => {
    const s = makeState();
    const rows = [
      ['07:00:00', `day2 countdown | ${NEXT} | - | ${d2('09:30')} | 13,14`],
      ['09:30:00', `day2 live | ${LIVE} | ${d2('09:30')} | ${d2('10:45')} | 13,14`],
      ['10:45:00', `day2 live | ${LIVE} | ${d2('10:45')} | ${d2('12:00')} | 15,16`],
      ['12:00:00', `day2 countdown | ${NEXT} | - | ${d2('13:00')} | 17,18`],
      ['13:00:00', `day2 live | ${LIVE} | ${d2('13:00')} | ${d2('14:15')} | 17,18`],
      ['14:15:00', `day2 countdown | ${NEXT} | - | ${d2('14:45')} | 19,20`],
      ['14:45:00', `day2 live | ${LIVE} | ${d2('14:45')} | ${d2('16:00')} | 19,20`],
      ['15:59:59', `day2 live | ${LIVE} | ${d2('14:45')} | ${d2('16:00')} | 19,20`],
      ['16:00:00', `day2 countdown | ${AWARDS} | - | ${d2('16:15')} | -`],
      ['16:14:59', `day2 countdown | ${AWARDS} | - | ${d2('16:15')} | -`],
      ['16:15:00', 'day2 none | Шагнал гардууллаа | - | - | -'],
      ['17:59:59', 'day2 none | Шагнал гардууллаа | - | - | -'],
    ];
    for (const [hms, want] of rows) assert.equal(brief(countdownFor(at(`2026-10-25T${hms}`), s)), want, hms);
  });

  test('over: no countdown', () => {
    const want = { phase: 'over', mode: 'none', label: 'Тэмцээн өндөрлөлөө', target: null, sub: null, chip: null, urgent: false };
    assert.deepEqual(countdownFor(at('2026-10-25T16:05:00'), endState()), want);
    assert.deepEqual(countdownFor(at('2026-10-25T18:00:00'), makeState()), want);
    assert.deepEqual(countdownFor(at('2026-10-26T10:00:00'), null), want);
  });
});

// ================================================================ regSummary
describe('regSummary', () => {
  test('hidden / test teams excluded; players clamped to 0–6; totals; counts only', () => {
    const s = regState();
    s.teams.push(
      { id: 99, code: 'test', name: 'ТЕСТ', pot: 1, is_teachers: false, is_hidden: true, reg: { players: 6, confirmed: true } },
      { id: 98, code: 'x', name: 'Нууц', pot: 1, is_teachers: false, is_hidden: true, reg: { players: 6, confirmed: true } },
      { id: 97, code: 'test', name: 'ТЕСТ 2', pot: 1, is_teachers: false, reg: { players: 6, confirmed: true } },
      null,
    );
    const team = (code) => s.teams.find((t) => t && t.code === code);
    team('12a').reg = { players: 9, confirmed: true, consents: 0 };   // → 6
    team('11a').reg = { players: -2, confirmed: false };              // → 0
    team('11b').reg = { players: 'abc', confirmed: false };           // → 0
    team('10a').reg = { players: '4', confirmed: false };             // → 4
    team('10b').reg = null;                                           // → 0, not confirmed
    team('10v').reg = { players: 6, confirmed: true };
    team('9a').players = [{ first_name: 'Бат' }];                     // an admin-shaped row must not leak
    const r = regSummary(s);
    assert.equal(r.total, 12);
    assert.equal(r.maxPlayers, 72);
    assert.ok(r.teams.every((t) => t.code !== 'test' && t.code !== 'x'));
    const got = Object.fromEntries(r.teams.map((t) => [t.code, t.players]));
    assert.deepEqual([got['12a'], got['11a'], got['11b'], got['10a'], got['10b'], got['10v']], [6, 0, 0, 4, 0, 6]);
    assert.equal(r.players, 16);
    assert.equal(r.confirmed, 2);
    for (const t of r.teams) assert.deepEqual(Object.keys(t).sort(), ['code', 'confirmed', 'id', 'is_teachers', 'name', 'players']);
    assert.ok(!JSON.stringify(r).includes('Бат'));
  });

  test('ranking: confirmed, more players, teachers last, then the site class order (12а … 8в)', () => {
    const s = regState();
    const set = (code, players, confirmed) => { s.teams.find((t) => t.code === code).reg = { players, confirmed, consents: 0 }; };
    set('8a', 6, true);
    set('12a', 6, true);
    set('teachers', 6, true);
    set('11a', 5, true);
    set('10b', 6, false);
    set('9a', 3, false);
    const want = ['12а', '8а', 'Багш нарын баг', '11а', '10б', '9а', '11б', '10а', '10в', '9б', '8б', '8в'];
    assert.deepEqual(regSummary(s).teams.map((t) => t.name), want);
    s.teams.reverse();                                            // input order does not matter
    assert.deepEqual(regSummary(s).teams.map((t) => t.name), want);
    // nobody registered yet (the live state on 10.19): same order as the home page — classes 12а … 8в, teachers last
    const home = [...TEAMS].sort((a, b) => (Number(a.is_teachers) - Number(b.is_teachers)) || (a.pot - b.pot) || (a.id - b.id));
    assert.deepEqual(regSummary(regState()).teams.map((t) => t.name), home.map((t) => t.name));
    assert.equal(home.at(-1).name, 'Багш нарын баг');
  });

  test('empty or malformed state', () => {
    const none = { teams: [], confirmed: 0, players: 0, total: 0, maxPlayers: 0 };
    for (const st of [null, undefined, {}, { teams: null }, { teams: 'x' }, { teams: [null] }]) assert.deepEqual(regSummary(st), none);
  });
});

// ================================================================ sweep invariants
describe('10.19 – 10.26 sweep', () => {
  const marks = new Set();
  for (let t = at('2026-10-19T00:00:00'); t <= at('2026-10-26T12:00:00'); t += 5 * MIN) marks.add(t);
  const edges = [...Object.values(TIMES), ...Object.values(DATES), ...MATCHES.flatMap((m) => [m.start, m.end])].map(Date.parse);
  for (const e of edges) for (const d of [-1, 0, 1]) marks.add(e + d);
  const states = {
    reg: regState(), regDrawn: regState({ draw: 'published' }), event: makeState(), ended: endState(), none: null,
  };

  test('slides: known ids with labels, static = live minus race/live, no slide twice in a row, all 21 reachable', () => {
    const seen = new Set();
    for (const [name, s] of Object.entries(states)) {
      for (const t of marks) {
        const live = slidesFor(t, s);
        const still = slidesFor(t, s, { live: false });
        const where = `${name} @ ${new Date(t).toISOString()}`;
        assert.ok(live.length >= 3, where);
        for (const id of live) {
          assert.ok(SLIDE_IDS.includes(id), `${where}: ${id}`);
          assert.ok(SLIDE_LABEL[id], `${where}: label of ${id}`);
          seen.add(id);
        }
        assert.deepEqual(still, live.filter((id) => !LIVE_ONLY.has(id)), where);
        for (let i = 0; i < live.length; i++) assert.notEqual(live[i], live[(i + 1) % live.length], where);
        for (let i = 0; i < still.length; i++) assert.notEqual(still[i], still[(i + 1) % still.length], where);
      }
    }
    assert.deepEqual([...seen].sort(), [...SLIDE_IDS].sort());
  });

  test('countdown: same phase as screenPhase, never a past target, live bar only inside a wave', () => {
    for (const [name, s] of Object.entries(states)) {
      for (const t of marks) {
        const c = countdownFor(t, s);
        const where = `${name} @ ${new Date(t).toISOString()}`;
        assert.equal(c.phase, screenPhase(t, s), where);
        assert.ok(['countdown', 'live', 'none'].includes(c.mode), where);
        assert.ok(typeof c.label === 'string' && c.label.length > 0, where);
        if (c.mode === 'countdown') assert.ok(Date.parse(c.target) > t, `${where}: target ${c.target}`);
        if (c.mode === 'live') {
          assert.ok(Date.parse(c.start) <= t && t < Date.parse(c.target), where);
          assert.deepEqual(c.matches.map((no) => STATION[no]).sort(), ['A', 'B'], where);
        }
        if (c.mode === 'none') assert.ok(c.target === null && (c.phase === 'over' || c.phase === 'day2'), where);
        if (c.matches && c.mode === 'countdown') {
          assert.ok(c.matches.every((no) => MATCHES.find((m) => m.no === no).start === c.target), where);
        }
        if (c.phase === 'reg') assert.equal(c.urgent, Date.parse(c.target) - t < 24 * HOUR, where);
        else assert.ok(c.sub === null && c.chip === null && c.urgent === false, where);
      }
    }
  });

  test('pure: deep-frozen state is never modified, nothing throws', () => {
    for (const s of Object.values(states)) {
      const frozen = deepFreeze(structuredClone(s));
      for (const t of [...marks].filter((_, i) => i % 7 === 0)) {
        settingsOf(frozen); finished(frozen); drawShown(frozen); regSummary(frozen);
        screenPhase(t, frozen); slidesFor(t, frozen); slidesFor(t, frozen, { live: false }); countdownFor(t, frozen);
      }
    }
  });
});

// ================================================================ text guard (screen sources)
const DOCS = fileURLToPath(new URL('../docs/', import.meta.url));
const SCREEN_JS = 'js/pages/screen.js';
const NAMED = [SCREEN_JS, 'js/phase.js', 'css/screen.css'];
const VALVE = 'Valve-ийн албан ёсны тэмцээн биш';

/** The named files plus any other screen* module / stylesheet (in case the page is split), relative to docs/. */
function guardFiles() {
  const out = new Set(NAMED);
  const walk = (rel) => {
    const abs = join(DOCS, rel);
    if (!existsSync(abs)) return;
    for (const f of readdirSync(abs)) {
      const r = `${rel}${f}`;
      if (statSync(join(DOCS, r)).isDirectory()) { if (/^screen/i.test(f) || /\/screen/i.test(rel)) walk(`${r}/`); continue; }
      if (/\.(?:m?js|css)$/i.test(f) && (/^screen/i.test(f) || /\/screen/i.test(rel))) out.add(r);
    }
  };
  for (const dir of ['js/', 'js/pages/', 'css/']) walk(dir);
  return [...out];
}

const REGEX_AFTER = new Set('(,=:[!&|?{};+-*%<>~^'.split(''));
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await']);

/**
 * `src` with its comments blanked (newlines kept, so line numbers stay right). JS: line and block comments; strings,
 * template literals (nested ${…} included) and regex literals are copied unchanged. css: block comments only.
 * HTML comments inside markup strings are blanked too. Comments are never shown on the screen, so they may mention
 * what the design avoids.
 */
function stripComments(src, { css = false } = {}) {
  const n = src.length;
  let i = 0;
  let out = '';
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  const quoted = (q) => {
    let j = i + 1;
    while (j < n && src[j] !== q && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
    j = Math.min(n, j + 1);
    out += src.slice(i, j);
    i = j;
  };
  const regex = () => {
    let j = i + 1;
    let cls = false;
    while (j < n && src[j] !== '\n') {
      const ch = src[j];
      if (ch === '\\') { j += 2; continue; }
      if (ch === '/' && !cls) break;
      if (ch === '[') cls = true;
      else if (ch === ']') cls = false;
      j += 1;
    }
    j = Math.min(n, j + 1);
    while (j < n && /[a-z]/i.test(src[j])) j += 1;
    out += src.slice(i, j);
    i = j;
  };
  let code;
  const template = () => {
    out += '`';
    i += 1;
    while (i < n) {
      const ch = src[i];
      if (ch === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
      if (ch === '`') { out += ch; i += 1; return; }
      if (ch === '$' && src[i + 1] === '{') { out += '${'; i += 2; code(true); continue; }
      out += ch;
      i += 1;
    }
  };
  code = (inExpr) => {
    let depth = 0;
    let prev = '';
    let word = '';
    while (i < n) {
      const ch = src[i];
      const nx = src[i + 1];
      if (ch === '/' && nx === '*') {
        const j = src.indexOf('*/', i + 2);
        const end = j < 0 ? n : j + 2;
        out += blank(src.slice(i, end));
        i = end;
        continue;
      }
      if (!css && ch === '/' && nx === '/') {
        const j = src.indexOf('\n', i);
        const end = j < 0 ? n : j;
        out += blank(src.slice(i, end));
        i = end;
        continue;
      }
      if (ch === '"' || ch === "'") { quoted(ch); prev = ch; word = ''; continue; }
      if (!css && ch === '`') { template(); prev = ch; word = ''; continue; }
      if (!css && ch === '/' && (!prev || REGEX_AFTER.has(prev) || REGEX_KEYWORDS.has(word))) { regex(); prev = ch; word = ''; continue; }
      if (inExpr && ch === '{') depth += 1;
      if (inExpr && ch === '}') {
        if (depth === 0) { out += ch; i += 1; return; }
        depth -= 1;
      }
      if (/[\w$]/.test(ch)) { word = /[\w$]/.test(src[i - 1] || '') ? word + ch : ch; prev = ch; } else if (!/\s/.test(ch)) { prev = ch; word = ''; }
      out += ch;
      i += 1;
    }
  };
  code(false);
  return out.replace(/<!--[\s\S]*?-->/g, blank);
}

/** Comment-free text of a docs/ file, ready to scan: NFC, no data: URIs / base64 blobs, NBSP / soft hyphen / zero-width tricks undone. */
function scanText(rel) {
  const src = readFileSync(join(DOCS, rel), 'utf8').normalize('NFC');
  const pad = (m) => ' '.repeat(m.length);
  return stripComments(src, { css: rel.endsWith('.css') })
    .replace(/data:[\w/+.-]+(?:;[\w=.-]+)*,[^\s"'`)]*/g, pad)
    .replace(/[A-Za-z0-9+/]{120,}={0,2}/g, pad)
    .replace(/\\u00a0|\\xa0|\\u202f|&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/\\u201[01]|&#8209;|&#x2011;/gi, '-')
    .replace(/[\u2010\u2011]/g, '-')
    .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, '');
}

/** Words as a regex: any whitespace (NBSP too) between them, case-insensitive (Cyrillic included). */
const words = (s) => new RegExp(s.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'iu');
/** An SVG path such as 'M4 4h16' or 'M249,12' is not a weapon name: no number may follow. */
const NOT_PATH = '(?![\\s,]*[-+.\\d])';

const FORBIDDEN = [
  // SPEC v5 «REMOVED» and the plan's forbidden copy
  ['old event / cup name «Ангийн аварга»', words('Ангийн аварга')],
  ['fee-free wording', /хураамжгүй|төлбөргүй|no\s+entry\s+fees?/iu],
  ['participation certificate «батламж»', /батламж/iu],
  ['removed award «Шударга тоглолт»', words('Шударга тоглолт')],
  ['removed award «Шилдэг тайлбарлагч»', words('Шилдэг тайлбарлагч')],
  ['stale SPEC wording', /wingman|\bMR8\b|сонгон\s+шалгаруулалт|олон\s+нийтэд\s+шууд\s+дамжуулахгүй|хувь\s+хүний\s+мэдээлэл\s+хамгаалах|зөвхөн\s+финалд\s+таарна|бэлэн\s+мөнгө,\s*skin|бүрэлдэхүүн\s+сугалаагаар|10\.16\s*\(Ба\)|10\.21\s*\(Лх\)\s*17:00/iu],
  // SPEC v6 «REMOVED»: no committee, no accountant, no waiting room, LED screen instead of a projector
  ['v6: accountant «нягтлан бодогч»', words('нягтлан бодогч')],
  ['v6: committee «Хороо»', /хороо/iu],
  ['v6: «мэдээлэл зүйн багш»', words('мэдээлэл зүйн багш')],
  ['v6: waiting room «хүлээлгийн өрөө»', words('хүлээлгийн өрөө')],
  ['v6: projector', /проектор|projector/iu],
  ['unfilled placeholder', /\[\[?(?:Захирлын овог нэр|Сургалтын менежерийн нэр|Мэдээлэл зүйн багшийн нэр|Нийгмийн ажилтны нэр|Нягтлан бодогчийн нэр|Лабын тоот|Танхимын нэр|Өрөөний тоот|Хот, дүүрэг)\]\]?/u],
  // weapon-free HUD (plan §4): no crosshair / reticle, no weapon names
  ['crosshair / reticle', /cross[\s_-]?hairs?|reticles?/iu],
  ['AK-47', /\bAK(?:[-\s]?47)?\b/],
  ['AWP', /\bAWP\b/i],
  ['M4A4 / M4A1-S', new RegExp(`\\bM4(?:A[14](?:-S)?)?\\b${NOT_PATH}`)],
  ['M249', new RegExp(`\\bM249\\b${NOT_PATH}`, 'i')],
  ['C4', new RegExp(`\\bC4\\b${NOT_PATH}`)],
  ['Desert Eagle', /deagle|desert[\s-]*eagle/i],
  ['pistols', /\bglock|\bUSP(?:-S)?\b|\bP(?:250|2000)\b|five-?seven|\btec-?9\b|\bCZ-?75|beretta|\brevolver\b|\bzeus\b/i],
  ['SMGs', /\bMP[579](?:-SD)?\b|\bMAC-?10\b|\bUMP(?:-?45)?\b|\bP90\b|\bbizon\b/i],
  ['rifles / heavy', /\bfamas\b|\bgalil\b|\bSG\s?553\b|\bSSG\s?08\b|\bSCAR-?20\b|\bG3SG1\b|\bnegev\b|\bXM1014\b|\bMAG-?7\b|sawed-?off/i],
  ['knives', /\bknife|\bknives\b|karambit|bayonet/i],
  ['grenades', /grenade|flashbang|molotov|incendiary|\bdecoy\b/i],
  ['guns', /\b(?:guns?|rifles?|pistols?|snipers?|shotguns?|weapons?|firearms?|ammo|ammunition)\b/i],
  ['gore', /\bblood|\bgore\b|\bskulls?\b|headshot/i],
  ['weapons / gore (Mongolian)', /(?<!\p{L})(?:буу(?:ны|гаар|нд|наас)?(?!\p{L})|гар\s+буу|хутга|гранат|винтов|снайпер|зэвсэг|цус|гавлын\s+яс)/iu],
];

function hits(text, re) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  const lines = text.split('\n');
  return [...text.matchAll(g)].map((m) => {
    const line = text.slice(0, m.index).split('\n').length;
    return `line ${line}: «${m[0]}» in: ${lines[line - 1].trim().slice(0, 160)}`;
  });
}

/** Phrase count after folding whitespace, case and hyphen variants. */
const fold = (s) => s.replace(/\s+/g, ' ').toLowerCase();
const countOf = (text, phrase) => fold(text).split(fold(phrase)).length - 1;

describe('text guard: screen sources', () => {
  test('guard helper: comments go, strings / templates / regex literals / URLs stay, lines kept', () => {
    const js = [
      "const a = 'https://x.mn/a'; // AWP crosshair",
      '/* Ангийн аварга */ const b = /\\/\\/[a-z]/g; const c = `x${"//"}y`;',
      'const d = `${a}/* stays */`; // M4A1',
      'const e = 1 / 2 / 3; const f = "\\"//\\"";',
      'const g = `<svg><!-- knife --><path d="M4 4h16"/></svg>`;',
    ].join('\n');
    const out = stripComments(js);
    assert.ok(!/AWP|crosshair|Ангийн|M4A1|knife/.test(out), out);
    for (const keep of ["'https://x.mn/a'", '/\\/\\/[a-z]/g', '`x${"//"}y`', '`${a}/* stays */`', '1 / 2 / 3', '"\\"//\\""', 'd="M4 4h16"']) {
      assert.ok(out.includes(keep), keep);
    }
    assert.equal(out.split('\n').length, js.split('\n').length);
    const css = stripComments('a { b: c } /* knife */ d::after { content: "//x" }', { css: true });
    assert.ok(!css.includes('knife') && css.includes('"//x"'));
    // the weapon patterns do not fire on SVG path data, and do fire on text
    const fire = (s) => FORBIDDEN.filter(([, re]) => re.test(s)).map(([label]) => label);
    assert.deepEqual(fire('<path d="M4 4h16v16H4z M249,12 C4.5 3 2 1 M4-2"/> MP4 #C4C4C4 drawPanel буудал Бүү'), []);
    assert.deepEqual(fire('AWP M249 C4 Deagle'), ['AWP', 'M249', 'C4', 'Desert Eagle']);
    assert.deepEqual(fire('АНГИЙН\u00a0АВАРГА'), ['old event / cup name «Ангийн аварга»']);
    assert.deepEqual(fire('M4A1 шиг'), ['M4A4 / M4A1-S']);
    assert.deepEqual(fire('Хутга'), ['weapons / gore (Mongolian)']);
  });

  for (const rel of guardFiles()) {
    const there = existsSync(join(DOCS, rel));
    test(`${rel}: no forbidden copy, weapon names or crosshairs`, { skip: there ? false : `${rel} is not written yet` }, () => {
      const text = scanText(rel);
      const problems = FORBIDDEN.flatMap(([label, re]) => hits(text, re).map((h) => `${label} — ${h}`));
      assert.deepEqual(problems, [], `${rel}:\n${problems.join('\n')}`);
    });
  }

  test(`«${VALVE}»: exactly once, in ${SCREEN_JS} only`, { skip: existsSync(join(DOCS, SCREEN_JS)) ? false : `${SCREEN_JS} is not written yet` }, () => {
    const counts = {};
    for (const rel of guardFiles()) if (existsSync(join(DOCS, rel))) counts[rel] = countOf(scanText(rel), VALVE);
    assert.equal(counts[SCREEN_JS], 1, JSON.stringify(counts));
    for (const [rel, n] of Object.entries(counts)) if (rel !== SCREEN_JS) assert.equal(n, 0, `${rel}: ${n}`);
    // no other «Valve … official» claim (a disclaimer without «биш» would imply endorsement)
    assert.equal(countOf(scanText(SCREEN_JS), 'Valve-ийн албан ёсны'), 1);
  });

  test('phase.js stays pure: imports only event.js; no DOM, network, storage, timers or clock', () => {
    const src = scanText('js/phase.js');
    assert.deepEqual([...src.matchAll(/\bimport\b[^'"]*['"]([^'"]+)['"]/g)].map((m) => m[1]), ['./event.js']);
    assert.deepEqual(src.match(/\b(?:document|window|globalThis|localStorage|sessionStorage|fetch|navigator|setTimeout|setInterval|Date\.now)\b|new Date\(\)/g), null);
  });
});

// ================================================================ SPEC v6 copy on the screen
describe('text guard: SPEC v6 people, places and own gear on the screen', () => {
  const there = existsSync(join(DOCS, SCREEN_JS));
  const skip = there ? false : `${SCREEN_JS} is not written yet`;
  const has = (text, phrase) => countOf(text, phrase) > 0;

  test('people and places come from config.js (STAFF, PLACES) — never typed into the screen sources', { skip }, () => {
    const src = scanText(SCREEN_JS);
    const imp = /import\s*\{([^}]*)\}\s*from\s*['"]\.\.\/config\.js['"]/.exec(src);
    assert.ok(imp, 'screen.js imports from ../config.js');
    for (const name of ['STAFF', 'PLACES']) assert.match(imp[1], new RegExp(`\\b${name}\\b`), name);
    for (const rel of guardFiles()) {
      if (!existsSync(join(DOCS, rel))) continue;
      const text = scanText(rel);
      const names = /Мөнгөншагай|Жаргал|Энхнаран|Бямбасамбуу|Б\.\s*Даваа|Мажигсүрэн|Windows\s+lab|Урлагийн\s+заал|60114971|94741053/giu;
      assert.deepEqual(hits(text, names), [], `${rel}: hard-coded person / place / phone`);
    }
    for (const use of ['STAFF.organiser', 'PLACES.hall', 'PLACES.lab']) assert.ok(src.includes(use), use);
  });

  test('fee: paid to the organiser against a receipt (no accountant); teams wait in their classrooms', { skip }, () => {
    const text = scanText(SCREEN_JS);
    for (const phrase of ['Хураамжаа зохион байгуулагч ${STAFF.organiser}д', 'баримт ав', '${PLACES.lab}-ын үүдэнд', 'ангидаа хүлээ']) {
      assert.ok(has(text, phrase), phrase);
    }
    assert.ok(has(text, '${PLACES.hall}ын LED дэлгэц'), 'spectators: the hall LED screen');
  });

  test('gear slide: headline, three icon cards (mouse, keyboard, headset) and the four rule lines', { skip }, () => {
    const text = scanText(SCREEN_JS);
    for (const phrase of ['Өөрийн хэрэгслээ', 'авчир!', "'Хулгана'", "'Гар'", "'Чихэвч'",
      'USB-ээр шууд залгагдана', 'Программ суулгахгүй — тохиргоо төхөөрөмж дээрээ', 'Макро, скрипт хориотой',
      'Нэр, ангиа шошголоод тоглолтын дараа авч яв']) {
      assert.ok(has(text, phrase), phrase);
    }
    for (const ico of ['mouse', 'keyboard', 'headset']) assert.match(text, new RegExp(`\\b${ico}:\\s*\\[`), `ICONS.${ico}`);
    assert.match(text, /\bgear:\s*\(\)\s*=>/, 'SLIDES.gear');
    assert.match(scanText('css/screen.css'), /\.s-gear\b/, 'screen.css styles .s-gear');
  });
});
