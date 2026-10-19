// «Сургуулийн аварга – CS2 2026» — лобби дэлгэцийн (#/screen) үе шат, слайдын жагсаалт, тоолуур.
// Pure module (event.js only): no DOM, no store; runs in browsers and in Node (tests/screen.test.mjs).
// All times are absolute instants (ms since epoch); calendar comparisons use fixed UTC+8 (Asia/Ulaanbaatar, no DST).
import { DATES, DRAW_AT, MATCHES } from './event.js';

/** Every slide the screen can show, in a stable order. */
export const SLIDE_IDS = Object.freeze([
  'hero', 'race', 'prize', 'join', 'fee', 'req', 'teachers', 'format', 'groups', 'dates',
  'kickoff', 'day1', 'day2', 'rules', 'watch', 'live', 'standings', 'bracket', 'champion', 'thanks',
]);

/** Short tab label of each slide («03/10 · ШАГНАЛ» — the page uppercases it). */
export const SLIDE_LABEL = Object.freeze({
  hero: 'Уриалга', race: 'Бүртгэлийн уралдаан', prize: 'Шагнал', join: 'Яаж оролцох', fee: 'Хураамж',
  req: 'Бэлтгэл', teachers: 'Багш нарын баг', format: 'Систем', groups: 'Хэсгүүд', dates: 'Гол хугацаа',
  kickoff: 'Тэмцээн эхэлнэ', day1: '1-р өдөр', day2: '2-р өдөр', rules: 'Дүрэм', watch: 'Шууд үзэх',
  live: 'Одоо', standings: 'Хэсгийн дүн', bracket: 'Хасагдах шат', champion: 'Аварга', thanks: 'Баярлалаа',
});

/** Event-day boundaries used by the screen (SPEC v5 §7). */
export const TIMES = Object.freeze({
  day1Open: '2026-10-24T07:00:00+08:00',   // screen switches to «event» mode
  day1Start: '2026-10-24T09:00:00+08:00',  // opening ceremony
  day1End: '2026-10-24T18:00:00+08:00',
  day2Open: '2026-10-25T07:00:00+08:00',
  day2First: '2026-10-25T09:30:00+08:00',  // first quarterfinals
  awards: '2026-10-25T16:15:00+08:00',
  day2End: '2026-10-25T18:00:00+08:00',
});

const UB = 8 * 3600e3;
const DAY_MS = 24 * 3600e3;
const ms = (iso) => { const v = Date.parse(iso); return Number.isFinite(v) ? v : NaN; };
const validIso = (v, def) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : def);
const ubDay = (t) => new Date(t + UB).toISOString().slice(0, 10);

/** Live settings with event.js fallbacks. The draw time is fixed (DRAW_AT) — it never comes from roster_freeze_at. */
export function settingsOf(state) {
  const s = (state && state.settings) || {};
  return {
    reg: validIso(s.reg_closes_at, DATES.reg_closes_at),
    consent: validIso(s.consent_deadline_at, DATES.consent_deadline_at),
    fee: DATES.fee_due_at,
    draw: DRAW_AT,
    open: s.registration_open !== false,
    stream: typeof s.stream_url === 'string' && /^https:\/\/\S+$/.test(s.stream_url) ? s.stream_url : null,
  };
}

/** Final (19) and 3rd-place match (20) are both official. */
export function finished(state) {
  const list = state && Array.isArray(state.matches) ? state.matches.filter((m) => m && (m.no === 19 || m.no === 20)) : [];
  return list.length === 2 && list.every((m) => m.status === 'final');
}

/** Groups may be shown only after the draw is published. */
export function drawShown(state) {
  const d = state && state.draw;
  return !!(d && d.status === 'published' && d.groups && typeof d.groups === 'object');
}

/** Site class order for ties (TEAMS / home page: 12а, 11а, 11б, 10а … 8в); unknown ids last. */
const teamRank = (t) => (typeof t.id === 'number' && Number.isFinite(t.id) ? t.id : Infinity);

/**
 * Registration progress of the public teams (hidden/test team excluded), ranked for the «race» slide:
 * confirmed first, then more players, then the teachers' team last, then the site's class order
 * (team id = TEAMS order, as on the home page; a plain string sort would put «10а» before «8а» and «12а»).
 */
export function regSummary(state) {
  const teams = (state && Array.isArray(state.teams) ? state.teams : [])
    .filter((t) => t && !t.is_hidden && t.code !== 'test')
    .map((t) => ({
      id: t.id,
      code: t.code,
      name: t.name,
      is_teachers: !!t.is_teachers,
      players: Math.max(0, Math.min(6, Number(t.reg && t.reg.players) || 0)),
      confirmed: !!(t.reg && t.reg.confirmed),
    }))
    .sort((a, b) => (Number(b.confirmed) - Number(a.confirmed)) || (b.players - a.players)
      || (Number(a.is_teachers) - Number(b.is_teachers)) || (teamRank(a) - teamRank(b))
      || String(a.name).localeCompare(String(b.name), 'mn', { numeric: true }));
  return {
    teams,
    confirmed: teams.filter((t) => t.confirmed).length,
    players: teams.reduce((n, t) => n + t.players, 0),
    total: teams.length,
    maxPlayers: teams.length * 6,
  };
}

/**
 * Screen phase at instant `now` (ms):
 * 'reg' (online registration open) → 'closed' (until 10.24 07:00) → 'day1' (07:00–18:00) → 'night' → 'day2' → 'over'
 * ('over' from 10.25 18:00, or earlier once the final and the 3rd-place match are official).
 */
export function screenPhase(now, state) {
  const s = settingsOf(state);
  if (now >= ms(TIMES.day2End) || (now >= ms(TIMES.day2Open) && finished(state))) return 'over';
  if (now >= ms(TIMES.day2Open)) return 'day2';
  if (now >= ms(TIMES.day1End)) return 'night';
  if (now >= ms(TIMES.day1Open)) return 'day1';
  if (s.open && now < ms(s.reg)) return 'reg';
  return 'closed';
}

/** Match waves of one day (both stations start together): [{ start, end, nos }] in time order. */
export function wavesOf(day) {
  const map = new Map();
  for (const m of MATCHES) {
    if (m.day !== day) continue;
    const w = map.get(m.start) || { start: m.start, end: m.end, nos: [] };
    if (ms(m.end) > ms(w.end)) w.end = m.end;
    w.nos.push(m.no);
    map.set(m.start, w);
  }
  return [...map.values()].sort((a, b) => ms(a.start) - ms(b.start));
}

/**
 * Slide ids for the rotation. live=false (export/static mode) drops slides that only make sense with live data
 * (the registration race and the «now playing» board).
 */
export function slidesFor(now, state, { live = true } = {}) {
  const p = screenPhase(now, state);
  const groups = drawShown(state) ? 'groups' : null;
  let list;
  switch (p) {
    case 'reg': list = ['hero', live ? 'race' : null, 'prize', 'join', 'fee', 'req', 'teachers', 'format', groups, 'dates']; break;
    case 'closed': list = ['kickoff', groups, 'day1', 'day2', 'prize', 'rules', 'watch']; break;
    case 'day1': list = live ? ['live', 'standings', 'live', 'day1', 'prize', 'watch'] : ['standings', 'day1', 'prize', 'watch']; break;
    case 'night': list = ['standings', 'day2', 'prize', 'watch']; break;
    case 'day2': list = live ? ['live', 'bracket', 'live', 'day2', 'prize', 'watch'] : ['bracket', 'day2', 'prize', 'watch']; break;
    default: list = ['champion', 'bracket', 'thanks'];
  }
  return list.filter(Boolean);
}

/**
 * What the right-rail countdown shows.
 * mode: 'countdown' (target = ISO to count to), 'live' (a match wave is on: start → target = wave end,
 * drawn as a round-timer bar), 'none' (after the event).
 * sub: an extra deadline line { label, at }; chip: a short alert text; urgent: < 24 h left (registration).
 */
export function countdownFor(now, state) {
  const p = screenPhase(now, state);
  const s = settingsOf(state);
  if (p === 'reg') {
    const left = ms(s.reg) - now;
    return {
      phase: p,
      mode: 'countdown',
      label: 'Онлайн бүртгэл хаагдах хүртэл',
      target: s.reg,
      sub: now < ms(s.fee) ? { label: 'Хураамж, зөвшөөрөл', at: s.fee } : null,
      chip: ubDay(now) === ubDay(ms(s.draw)) && now < ms(s.draw) ? 'Өнөөдөр 16:00 — хэсгийн сугалаа' : null,
      urgent: left < DAY_MS,
    };
  }
  if (p === 'closed') {
    return { phase: p, mode: 'countdown', label: 'Тэмцээн эхлэх хүртэл', target: TIMES.day1Start, sub: null, chip: null, urgent: false };
  }
  if (p === 'day1' || p === 'day2') {
    const waves = wavesOf(p === 'day1' ? 1 : 2);
    const cur = waves.find((w) => now >= ms(w.start) && now < ms(w.end));
    if (cur) {
      return { phase: p, mode: 'live', label: 'Одоо тоглож байна', start: cur.start, target: cur.end, matches: cur.nos, sub: null, chip: null, urgent: false };
    }
    const next = waves.find((w) => ms(w.start) > now);
    if (next) {
      return { phase: p, mode: 'countdown', label: 'Дараагийн тоглолт хүртэл', target: next.start, matches: next.nos, sub: null, chip: null, urgent: false };
    }
    if (p === 'day2' && now < ms(TIMES.awards)) {
      return { phase: p, mode: 'countdown', label: 'Шагнал гардуулах хүртэл', target: TIMES.awards, sub: null, chip: null, urgent: false };
    }
    if (p === 'day1') {
      return { phase: p, mode: 'countdown', label: 'Шөвгийн 8 эхлэх хүртэл', target: TIMES.day2First, sub: null, chip: null, urgent: false };
    }
    return { phase: p, mode: 'none', label: 'Шагнал гардууллаа', target: null, sub: null, chip: null, urgent: false };
  }
  if (p === 'night') {
    return { phase: p, mode: 'countdown', label: 'Шөвгийн 8 эхлэх хүртэл', target: TIMES.day2First, sub: null, chip: null, urgent: false };
  }
  return { phase: p, mode: 'none', label: 'Тэмцээн өндөрлөлөө', target: null, sub: null, chip: null, urgent: false };
}
