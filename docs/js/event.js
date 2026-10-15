// «Сургуулийн аварга – CS2 2026» — тэмцээний тогтмол өгөгдөл (CONTRACT §2, SPEC v5 §2, §2a, §3, §5, §7).
// Pure data module: no DOM, no dependencies; works in browsers and Node >= 22.
// The SQL seed mirrors TEAMS and MATCHES — change both together.
// Every export is deep-frozen: copy before you modify (e.g. `MATCHES.map((m) => ({ ...m }))`).

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

/** Event name (SPEC v5 §1), transferable cup name and champion title (SPEC v5 §0, §5). */
export const EVENT_NAME = 'Сургуулийн аварга – CS2 2026';
export const CUP_NAME = 'Сургуулийн аварга';
export const CHAMPION_TITLE = 'Сургуулийн аварга анги';

/**
 * Key dates (SPEC v5 §2, §3, §13), ISO +08:00 (Asia/Ulaanbaatar).
 * reg_closes_at, roster_freeze_at and consent_deadline_at equal the cs2.settings values after migration 12;
 * pages prefer the live settings and fall back to these. The draw does NOT freeze rosters:
 * anything labelled «сугалаа» uses draw_at, never roster_freeze_at.
 */
export const DATES = deepFreeze({
  reg_closes_at: '2026-10-23T23:59:59+08:00',        // online registration closes (class QR + PIN)
  roster_freeze_at: '2026-10-23T23:59:59+08:00',     // roster freeze = registration close
  consent_deadline_at: '2026-10-23T17:00:00+08:00',  // paper consent 05 + 05б, paper form 04
  fee_due_at: '2026-10-23T17:00:00+08:00',           // team fee to the school accountant
  drill_from: '2026-10-19T00:00:00+08:00',           // Steam QR login drills 10.19–10.23
  drill_to: '2026-10-23T18:00:00+08:00',
  draw_commit_on: '2026-10-21T00:00:00+08:00',       // commit (SHA-256) published on the portal
  draw_at: '2026-10-22T16:00:00+08:00',              // technical meeting + group draw
  links_expire_at: '2026-10-25T18:00:00+08:00',      // class and referee links
});

/** Group draw time (10.22 (Пү) 16:00). */
export const DRAW_AT = DATES.draw_at;

/**
 * Team fee and prize fund in ₮ (SPEC v5 §2a, §5, §10B). The teachers' team pays no fee and gets no cash.
 * 11 × 120 000 = 1 320 000 = fund 1 200 000 (600 000 / 360 000 / 240 000) + MVP 100 000 + small MVP cup 20 000.
 */
export const FEE = deepFreeze({ team: 120000, per_player: 20000, teams: 11, total: 1320000 });
export const PRIZES = deepFreeze({
  fund: 1200000,
  place: [600000, 360000, 240000],        // 1st, 2nd, 3rd class team
  per_player: [100000, 60000, 40000],     // shared equally among the 6 players
  mvp_cash: 100000,
  mvp_cup: 20000,
});

/** Group keys (Latin, internal). Show them with GROUP_LABEL. */
export const GROUPS = deepFreeze(['A', 'B', 'V', 'G']);

/** Cyrillic display letter of each group key. */
export const GROUP_LABEL = deepFreeze({ A: 'А', B: 'Б', V: 'В', G: 'Г' });

/** Group colours for fills and large text (CONTRACT §2). */
export const GROUP_COLOR = deepFreeze({ A: '#2563EB', B: '#16A34A', V: '#EA580C', G: '#9333EA' });

/** Darker group colours for small text on white (same as app.css --gX-t). */
export const GROUP_TEXT_COLOR = deepFreeze({ A: '#2563EB', B: '#15803D', V: '#C2410C', G: '#9333EA' });

/** Station display labels. */
export const STATION_LABEL = deepFreeze({ A: 'А станц', B: 'Б станц' });

/** Stage display labels (group, quarterfinal, semifinal, final, 3rd-place match). */
export const STAGE_LABEL = deepFreeze({
  group: 'Хэсгийн шат', qf: 'Шөвгийн 8', sf: 'Шөвгийн 4', final: 'Финал', third: '3-р байрын тоглолт',
});

/**
 * The 12 teams: id, code (Latin key), name (display), pot (1–3), is_teachers.
 * Pot order = SPEC §3 listing order. The hidden DB test team (id 99, 'test') is never listed here.
 */
export const TEAMS = deepFreeze([
  { id: 1, code: '12a', name: '12а', pot: 1, is_teachers: false },
  { id: 2, code: '11a', name: '11а', pot: 1, is_teachers: false },
  { id: 3, code: '11b', name: '11б', pot: 1, is_teachers: false },
  { id: 4, code: 'teachers', name: 'Багш нарын баг', pot: 1, is_teachers: true },
  { id: 5, code: '10a', name: '10а', pot: 2, is_teachers: false },
  { id: 6, code: '10b', name: '10б', pot: 2, is_teachers: false },
  { id: 7, code: '10v', name: '10в', pot: 2, is_teachers: false },
  { id: 8, code: '9a', name: '9а', pot: 2, is_teachers: false },
  { id: 9, code: '9b', name: '9б', pot: 3, is_teachers: false },
  { id: 10, code: '8a', name: '8а', pot: 3, is_teachers: false },
  { id: 11, code: '8b', name: '8б', pot: 3, is_teachers: false },
  { id: 12, code: '8v', name: '8в', pot: 3, is_teachers: false },
]);

/** Order of the 12 draw numbers in the draw input string (CONTRACT §3). */
export const DRAW_ORDER = deepFreeze(['12a', '11a', '11b', 'teachers', '10a', '10b', '10v', '9a', '9b', '8a', '8b', '8v']);

const D1 = '2026-10-24T';
const D2 = '2026-10-25T';
const TZ = ':00+08:00';

/** Day 1 group match (MR12, no overtime, 12:12 draw allowed). 'seat:A1' = group A seat 1 (= its pot-1 team). */
const g = (no, grp, station, start, end, a, b) => ({
  no, day: 1, stage: 'group', code: null, grp, station,
  start: `${D1}${start}${TZ}`, end: `${D1}${end}${TZ}`, src_a: `seat:${grp}${a}`, src_b: `seat:${grp}${b}`,
});

/** Day 2 knockout match (MR12 + overtime MR3). 'rank:A1' = group A winner, 'W:13' / 'L:17' = winner / loser of a match. */
const k = (no, stage, code, station, start, end, srcA, srcB) => ({
  no, day: 2, stage, code, grp: null, station, start: `${D2}${start}${TZ}`, end: `${D2}${end}${TZ}`, src_a: srcA, src_b: srcB,
});

/**
 * All 20 matches in match-number order: no, day, stage, code, grp, station, start, end (ISO, +08:00), src_a, src_b.
 * Groups А and В play on station A, Б and Г on station B. Same-group teams can meet again only in the final or the 3rd-place match.
 */
export const MATCHES = deepFreeze([
  g(1, 'A', 'A', '09:45', '10:45', 1, 2),
  g(2, 'B', 'B', '09:45', '10:45', 1, 2),
  g(3, 'V', 'A', '10:45', '11:45', 1, 2),
  g(4, 'G', 'B', '10:45', '11:45', 1, 2),
  g(5, 'A', 'A', '11:45', '12:45', 1, 3),
  g(6, 'B', 'B', '11:45', '12:45', 1, 3),
  g(7, 'V', 'A', '13:45', '14:45', 1, 3),
  g(8, 'G', 'B', '13:45', '14:45', 1, 3),
  g(9, 'A', 'A', '14:45', '15:45', 2, 3),
  g(10, 'B', 'B', '14:45', '15:45', 2, 3),
  g(11, 'V', 'A', '15:45', '16:45', 2, 3),
  g(12, 'G', 'B', '15:45', '16:45', 2, 3),
  k(13, 'qf', '1/4-1', 'A', '09:30', '10:45', 'rank:A1', 'rank:B2'),
  k(14, 'qf', '1/4-3', 'B', '09:30', '10:45', 'rank:B1', 'rank:A2'),
  k(15, 'qf', '1/4-2', 'A', '10:45', '12:00', 'rank:V1', 'rank:G2'),
  k(16, 'qf', '1/4-4', 'B', '10:45', '12:00', 'rank:G1', 'rank:V2'),
  k(17, 'sf', '1/2-1', 'A', '13:00', '14:15', 'W:13', 'W:15'),
  k(18, 'sf', '1/2-2', 'B', '13:00', '14:15', 'W:14', 'W:16'),
  k(19, 'final', 'Финал', 'A', '14:45', '16:00', 'W:17', 'W:18'),
  k(20, 'third', '3-р байр', 'B', '14:45', '16:00', 'L:17', 'L:18'),
]);

/** Fixed non-match blocks for the two timetables (SPEC §7): [time 'HH:MM', label]. */
export const DAY_INFO = deepFreeze({
  d1: [['08:30', 'Бүртгэл'], ['09:00', 'Нээлт'], ['09:30', 'Нэвтрэлт, халаалт'], ['12:45', 'Үдийн цай (13:45 хүртэл)'], ['16:45', 'Нөөц цаг (17:45 хүртэл)']],
  d2: [['08:30', 'Нөөц ээлж (шаардлагатай бол)'], ['08:45', 'Бүртгэл'], ['12:00', 'Үдийн цай (13:00 хүртэл)'], ['14:15', 'Завсарлага'], ['16:15', 'Шагнал гардуулах, шилжин явах цом']],
});
