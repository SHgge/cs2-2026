// «Хуваарь» хуудас. Мөн бусад нийтийн хуудас (groups, bracket, tv, home) ашигладаг туслахуудыг экспортолно.
// Өгөгдлийг зөвхөн ui.h (textContent)-ээр гаргана. Тоглогчийн нэр хэзээ ч харуулахгүй — зөвхөн ангийн нэр.
import { h, clear, fmtTime, fmtDate, loading, groupChip } from '../ui.js';
import { store } from '../store.js';
import { PLACES } from '../config.js';
import { MATCHES, DAY_INFO, GROUP_LABEL, STATION_LABEL, TEAMS } from '../event.js';
import { resolveMatches, fmtScore, mapPool, mapInfo, vetoState } from '../logic.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

export const DAYS = [
  { key: '2026-10-24', title: '1-р өдөр', info: 'd1', sub: 'Хэсгийн шат · MR12, нэмэлт цаггүй · 12:12 бол тэнцээ' },
  { key: '2026-10-25', title: '2-р өдөр', info: 'd2', sub: 'Хасагдах шат · MR12, тэнцвэл нэмэлт цаг (MR3)' },
];
export const STAGE_LABEL = { group: 'Хэсгийн шат', qf: 'Шөвгийн 8', sf: 'Шөвгийн 4', final: 'Финал', third: '3-р байр' };
const DONE = new Set(['reported', 'final']);
const WD_SHORT = { 'Ням': 'Ня', 'Даваа': 'Да', 'Мягмар': 'Мя', 'Лхагва': 'Лх', 'Пүрэв': 'Пү', 'Баасан': 'Ба', 'Бямба': 'Бя' };
const GEN = { 1: 'ийн', 2: 'ын', 3: 'ын', 4: 'ийн' };   // «1/4-1-ийн», «1/4-2-ын» …

// ---------- жижиг туслахууд ----------
export function tms(iso) { const t = Date.parse(iso); return Number.isFinite(t) ? t : NaN; }
/** 'YYYY-MM-DD' Улаанбаатарын цагаар (UTC+8, зуны цаггүй). */
export function ubDay(ms) { return Number.isFinite(ms) ? new Date(ms + 8 * HOUR).toISOString().slice(0, 10) : ''; }
/** 10.24 (Бя) */
export function fmtDateShort(iso) { return fmtDate(iso).replace(/\(([^)]+)\)/, (_, w) => `(${WD_SHORT[w] || w})`); }
export function safe(fn, fallback = null) {
  try { const v = fn(); return v === undefined ? fallback : v; } catch (e) { console.warn(e); return fallback; }
}
export const isDone = (m) => !!m && DONE.has(m.status);

/** Сугалаа албан ёсоор нийтлэгдэхээс өмнө хэсгийн бүрэлдэхүүнийг нийтийн хуудсанд харуулахгүй. */
export function publicView(state) {
  if (!state || !state.draw || state.draw.status === 'published') return state;
  return { ...state, draw: { ...state.draw, groups: null } };
}
export function drawPublished(state) {
  const d = state && state.draw;
  return !!(d && d.status === 'published' && d.groups);
}

export function teamLabel(state, id) {
  if (id == null) return null;
  const list = state && Array.isArray(state.teams) ? state.teams : [];
  const t = list.find((x) => x.id === id) || TEAMS.find((x) => x.id === id);
  return t ? t.name : null;
}
export function nameByCode(state, code) {
  const list = state && Array.isArray(state.teams) ? state.teams : [];
  const t = list.find((x) => x.code === code) || TEAMS.find((x) => x.code === code);
  return t ? t.name : String(code || '—');
}

/** 'seat:A1' → «А1»; 'rank:B2' → «Б№2» (long: «Б хэсгийн 2-р байр»); 'W:13' → «1/4-1-ийн ялагч». */
export function srcLabel(src, { long = false } = {}) {
  const s = String(src || '');
  const i = s.indexOf(':');
  if (i < 0) return s || '—';
  const kind = s.slice(0, i);
  const val = s.slice(i + 1);
  if (kind === 'seat') return `${GROUP_LABEL[val[0]] || val[0]}${val.slice(1)}`;
  if (kind === 'rank') {
    const g = GROUP_LABEL[val[0]] || val[0];
    return long ? `${g} хэсгийн ${val.slice(1)}-р байр` : `${g}№${val.slice(1)}`;
  }
  if (kind === 'W' || kind === 'L') {
    const base = MATCHES.find((m) => m.no === Number(val));
    const code = (base && base.code) || `№${val}`;
    return `${code}-${GEN[code.slice(-1)] || 'ийн'} ${kind === 'W' ? 'ялагч' : 'ялагдагч'}`;
  }
  return s;
}

/** Нэг талын харагдах нэр: анги эсвэл суудал/байрын тэмдэглэгээ. */
export function sideInfo(state, m, side, { long = false } = {}) {
  const id = side === 'a' ? m.team_a : m.team_b;
  const src = side === 'a' ? m.src_a : m.src_b;
  const name = teamLabel(state, id);
  if (name) return { text: name, known: true, id };
  return { text: srcLabel(src, { long }), known: false, title: srcLabel(src, { long: true }) };
}

const BASE_KEYS = ['stage', 'code', 'grp', 'station', 'start', 'end'];
/** Газрын зургийн хасалтын талбарууд (13-р migration). Хуучин төлөвт байхгүй → тоглолтод ч нэмэхгүй. */
const VETO_KEYS = ['veto_first', 'veto_coin', 'veto', 'map'];
/** event.MATCHES + төлөвийн оноо/төлөв/хасалт + logic.resolveMatches-ийн багууд. Хугацаагаар эрэмбэлсэн. */
export function mergedMatches(state) {
  const view = publicView(state);
  const live = new Map();
  for (const m of (view && Array.isArray(view.matches) ? view.matches : [])) if (m && m.no != null) live.set(Number(m.no), m);
  const resolved = view ? safe(() => resolveMatches(view, { official: true }), []) : [];
  const res = new Map();
  for (const m of (Array.isArray(resolved) ? resolved : [])) if (m && m.no != null) res.set(Number(m.no), m);
  return MATCHES.map((base) => {
    const l = live.get(base.no) || {};
    const r = res.get(base.no) || {};
    const m = {
      ...base,
      status: l.status || 'scheduled', score_a: l.score_a ?? null, score_b: l.score_b ?? null,
      ot: l.ot ?? null, forfeit: l.forfeit ?? null,
    };
    for (const k of BASE_KEYS) if (l[k] != null && l[k] !== '') m[k] = l[k];
    for (const k of VETO_KEYS) if (l[k] !== undefined) m[k] = l[k];
    m.src_a = base.src_a; m.src_b = base.src_b;
    m.team_a = r.team_a ?? null; m.team_b = r.team_b ?? null;
    return m;
  }).sort(byTime);
}
export function byTime(a, b) {
  return (tms(a.start) - tms(b.start)) || String(a.station).localeCompare(String(b.station)) || (a.no - b.no);
}

export function winnerSide(m) {
  if (m.forfeit === 'a') return 'b';
  if (m.forfeit === 'b') return 'a';
  if (m.score_a == null || m.score_b == null) return null;
  if (m.score_a > m.score_b) return 'a';
  if (m.score_b > m.score_a) return 'b';
  return null;
}
export function scoreText(m) {
  if (m.score_a == null || m.score_b == null) return '';
  return safe(() => fmtScore(m), null) || `${m.score_a} : ${m.score_b}`;
}
export function statusOf(m) {
  switch (m && m.status) {
    case 'final': return { key: 'final', text: 'Дууссан' };
    case 'reported': return { key: 'reported', text: 'Урьдчилсан дүн' };
    case 'live': return { key: 'live', text: 'Явагдаж байна' };
    case 'postponed': return { key: 'warn', text: 'Хойшилсон' };
    case 'cancelled': case 'canceled': return { key: 'warn', text: 'Цуцалсан' };
    default: return { key: 'scheduled', text: '' };
  }
}
/** «ОДОО»: шүүгч эхлүүлсэн, эсвэл цагийн хувьд явагдаж буй (дүн ороогүй) тоглолт. */
export function isNow(m, now) {
  if (!m) return false;
  if (m.status === 'live') return true;
  if (isDone(m) || m.status === 'postponed' || m.status === 'cancelled') return false;
  const s = tms(m.start); const e = tms(m.end);
  return Number.isFinite(s) && Number.isFinite(e) && now >= s && now < e;
}

/** Станц бүрийн одоогийн, дараагийн, сүүлд дууссан тоглолт. */
export function stationNowNext(rows, station, now) {
  const list = rows.filter((m) => m.station === station);
  const current = list.find((m) => m.status === 'live') || list.find((m) => isNow(m, now)) || null;
  const from = current ? tms(current.start) : now;
  const next = list.find((m) => m !== current && !isDone(m) && m.status !== 'live'
    && (current ? tms(m.start) >= from : tms(m.start) > now)) || null;
  const last = [...list].reverse().find((m) => isDone(m) && tms(m.start) <= now) || null;
  return { current, next, last };
}
/** Дараагийн ээлж: багуудыг 15 минутын өмнө ангиас нь дуудаж, Windows lab-ын үүдэнд авчирна (SPEC v6 §0b.4). */
export function nextWave(rows, now) {
  const fut = rows.filter((m) => !isDone(m) && m.status !== 'live' && tms(m.start) > now);
  if (!fut.length) return null;
  const t = Math.min(...fut.map((m) => tms(m.start)));
  return { start: t, callAt: t - 15 * MIN, matches: fut.filter((m) => tms(m.start) === t).sort(byTime) };
}

/** Төхөөрөмжийн цаг 1 минутаас илүү зөрвөл серверийн цагийг ашиглана. */
export function makeClock() {
  let skew = 0;
  return {
    observe(state) {
      const s = state && state.now ? Date.parse(state.now) - Date.now() : NaN;
      if (Number.isFinite(s)) skew = Math.abs(s) > MIN ? s : 0;
    },
    now() { return Date.now() + skew; },
  };
}

/** Үндсэн хуваарь (API хүрэхгүй үед). */
export function fallbackState() {
  return {
    ok: false, offline: true, version: null, now: null, settings: {}, announcements: [],
    teams: TEAMS.map((t) => ({ id: t.id, code: t.code, name: t.name, pot: t.pot, is_teachers: !!t.is_teachers, reg: null })),
    draw: { status: 'none', groups: null, history: [] },
    matches: MATCHES.map((m) => ({
      no: m.no, stage: m.stage, code: m.code || null, grp: m.grp || null, station: m.station, start: m.start, end: m.end,
      status: 'scheduled', score_a: null, score_b: null, ot: null, forfeit: null, team_a: null, team_b: null,
    })),
    decisions: {},
  };
}

/**
 * store-д холбогдоно: эхэндээ «Ачаалж байна», алдаа гарвал үндсэн хуваариар (offline) зурна.
 * onData(state, {offline, error}) өгөгдөл өөрчлөгдөх бүрт дуудагдана. Буцаах утга = цэвэрлэгч.
 */
export function bindState(box, onData, clock) {
  let shown = false;
  let lastSeen = null;
  let armed = false;
  const handler = (state, meta) => {
    const m = meta || {};
    if (state) {
      if (clock && armed && state !== lastSeen && !m.error) clock.observe(state);
      lastSeen = state;
      shown = true;
      onData(state, { offline: false, error: m.error || null });
    } else if (m.error) {
      shown = true;
      onData(fallbackState(), { offline: true, error: m.error });
    }
  };
  const unsub = store.subscribe(handler);
  armed = true;
  let slow = null;
  if (!shown) {
    const st = store.status();
    if (st.error) handler(null, st);
    else {
      loading(box);
      slow = setTimeout(() => { if (!shown) handler(null, { error: 'slow' }); }, 10000);
    }
  }
  return () => { unsub(); clearTimeout(slow); };
}

export function offlineNote(info) {
  if (!info || (!info.offline && !info.error)) return null;
  if (info.offline) {
    return h('div', { class: 'card warn pub-offline', role: 'status' },
      h('p', {}, 'Шинэ мэдээлэл ачаалж чадсангүй. Үндсэн хуваарийг харуулж байна.'),
      h('button', {
        class: 'btn secondary', type: 'button',
        onclick: (e) => { e.currentTarget.disabled = true; e.currentTarget.textContent = 'Ачаалж байна…'; store.refresh(); },
      }, 'Дахин оролдох'));
  }
  return h('p', { class: 'muted small pub-stale', role: 'status' }, 'Холболт түр тасарлаа. Сүүлийн мэдээллийг харуулж байна.');
}

/**
 * Газрын зургийн хасалт (удирдамж 02 §7.9): logic.vetoState + pool (харуулах дараалал) + map (тоглох газрын зураг).
 * Төлөвт хасалтын талбар байхгүй бол (13-р migration-аас өмнө) null — юу ч нэмж харуулахгүй.
 */
export function vetoInfo(state, m) {
  if (!m || (!Array.isArray(m.veto) && typeof m.map !== 'string')) return null;
  return safe(() => {
    const pool = mapPool(state);
    const v = vetoState(m, pool);
    const map = v.map || (pool.includes(m.map) ? m.map : null);
    return { ...v, pool, map, done: v.done || !!map };
  }, null);
}
export const mapName = (key) => mapInfo(key).name;

// ---------- тоглолтын карт (schedule, groups, home) ----------
export function stageTag(m) {
  if (m.stage === 'group' && m.grp) return groupChip(m.grp);
  const label = (m.stage === 'qf' || m.stage === 'sf') ? `${STAGE_LABEL[m.stage]} · ${m.code || ''}` : (STAGE_LABEL[m.stage] || m.code || '');
  return h('span', { class: `chip pub-ko${m.stage === 'final' ? ' gold' : ''}` }, label);
}

/** Хасалт эхэлсний дараа: хассан газрын зургууд (зурсан, жижиг), шийдэгдвэл «Газрын зураг: Mirage». */
function vetoLine(state, m) {
  const v = vetoInfo(state, m);
  if (!v || (!v.started && !v.map)) return null;
  const who = (side) => sideInfo(state, m, side).text;
  return h('div', { class: 'pm-veto' },
    v.map
      ? h('span', { class: 'pm-map' }, 'Газрын зураг: ', h('b', {}, mapName(v.map)))
      : h('span', { class: 'pm-vstep' }, `Газрын зургийн хасалт ${v.steps.length}/${v.total}:`),
    v.steps.length
      ? h('span', { class: 'pm-bans' }, v.map ? h('span', { class: 'visually-hidden' }, 'Хассан:') : null,
        v.steps.map((x) => h('s', { title: `${who(x.side)} хассан` }, mapName(x.map))))
      : null);
}

function teamSpan(info, cls) {
  return h('span', { class: `pm-team${info.known ? '' : ' ph'}${cls}`, title: info.known ? null : info.title }, info.text);
}

export function matchCard(state, m, now, { station = true, time = false, stage = true, veto = true } = {}) {
  const done = isDone(m);
  const live = isNow(m, now);
  const win = done ? winnerSide(m) : null;
  const st = statusOf(m);
  const score = done ? scoreText(m) : '';
  const A = sideInfo(state, m, 'a');
  const B = sideInfo(state, m, 'b');
  const mark = (side) => (win === side ? ' win' : win ? ' lost' : '');
  return h('article', { class: `pm${m.grp ? ` gc-${m.grp}` : ` ko-${m.stage}`}${live ? ' is-now' : ''}${done ? ' is-done' : ''}` },
    h('div', { class: 'pm-head' },
      time ? h('b', { class: 'pm-time' }, fmtTime(m.start)) : null,
      station ? h('span', { class: 'pm-st' }, STATION_LABEL[m.station] || '') : null,
      stage ? stageTag(m) : null,
      live ? h('span', { class: 'chip pub-now' }, 'ОДОО') : (st.text ? h('span', { class: `pm-status s-${st.key}` }, st.text) : null)),
    h('div', { class: 'pm-body' },
      teamSpan(A, mark('a')),
      score ? h('span', { class: 'pm-score' }, score) : h('span', { class: 'pm-vs', 'aria-label': 'эсрэг' }, '–'),
      teamSpan(B, `${mark('b')} r`)),
    veto ? vetoLine(state, m) : null);
}

// ---------- «Хуваарь» хуудас ----------
const POSTERS = {
  d1: ['assets/img/12a_Huvaari_1r_odor.png', '1-р өдрийн зурагт хуваарь'],
  d2: ['assets/img/12b_Huvaari_2r_odor.png', '2-р өдрийн зурагт хуваарь'],
};

/** DAY_INFO мөрийн байршил (SPEC v6 §7): нээлт Урлагийн заалд. */
const VENUE = { d1: { '09:00': PLACES.hall } };

function infoRow(it) {
  return h('div', { class: 'sc-info' }, h('b', {}, it.hhmm),
    h('span', {}, it.text, it.venue ? h('span', { class: 'sc-venue' }, ` (${it.venue})`) : null));
}

function slotRow(state, it, now) {
  const ms = it.ms.slice().sort(byTime);
  const ends = ms.map((m) => tms(m.end)).filter(Number.isFinite);
  const end = ends.length ? new Date(Math.max(...ends)).toISOString() : null;
  const live = ms.some((m) => isNow(m, now));
  return h('section', { class: `sc-slot${live ? ' is-now' : ''}`, 'aria-label': `${fmtTime(ms[0].start)} цагийн ээлж` },
    h('div', { class: 'sc-time' },
      h('b', {}, fmtTime(ms[0].start)),
      end ? h('span', {}, `– ${fmtTime(end)}`) : null),
    h('div', { class: 'sc-ms' }, ms.map((m) => matchCard(state, m, now))));
}

function timeline(state, rows, day, now) {
  const list = h('div', { class: 'sc-list' });
  const dayRows = rows.filter((m) => ubDay(tms(m.start)) === day.key);
  const slots = new Map();
  for (const m of dayRows) {
    const k = tms(m.start);
    if (!slots.has(k)) slots.set(k, []);
    slots.get(k).push(m);
  }
  const items = [];
  for (const [t, ms] of slots) items.push({ t, kind: 'slot', ms });
  for (const [hhmm, text] of ((DAY_INFO && DAY_INFO[day.info]) || [])) {
    items.push({ t: tms(`${day.key}T${hhmm}:00+08:00`), kind: 'info', hhmm, text, venue: (VENUE[day.info] || {})[hhmm] || null });
  }
  items.sort((a, b) => (a.t - b.t) || (a.kind === 'info' ? -1 : 1));
  for (const it of items) list.appendChild(it.kind === 'info' ? infoRow(it) : slotRow(state, it, now));
  if (!dayRows.length) list.appendChild(h('p', { class: 'muted' }, 'Энэ өдөр тоглолт алга.'));
  return list;
}

function nowBox(state, rows, now) {
  const cur = rows.filter((m) => isNow(m, now));
  if (!cur.length) return null;
  return h('button', {
    type: 'button', class: 'card sc-nowbox',
    onclick: () => { const el = document.querySelector('.sc-slot.is-now'); if (el) el.scrollIntoView({ block: 'center' }); },
  },
  h('span', { class: 'chip pub-now' }, 'ОДОО'),
  h('span', { class: 'sc-nowlist' }, cur.map((m) => {
    const A = sideInfo(state, m, 'a'); const B = sideInfo(state, m, 'b');
    return h('span', {}, `${STATION_LABEL[m.station] || ''}: ${A.text} – ${B.text}`);
  })),
  h('span', { class: 'sc-nowgo', 'aria-hidden': 'true' }, '›'));
}

function legend(day) {
  return h('div', { class: 'sc-legend small muted' },
    day.info === 'd1'
      ? [h('p', {}, 'А1 = А хэсгийн 1-р суудал (1-р сагсны баг). Эхэнд бичигдсэн баг газрын зургийг эхэлж хасна.'),
        h('p', {}, 'Хожил 3, тэнцээ 1, хожигдол 0 оноо. Хэсгийн 1, 2-р байр шөвгийн 8-д шалгарна.')]
      : [h('p', {}, 'А№1 = А хэсгийн 1-р байр. Нэг хэсгийн 2 баг дахин таарвал зөвхөн финал эсвэл 3-р байрын тоглолтод таарна.'),
        h('p', {}, '16:15 — хаалт: шагнал гардуулах, шилжин явах цом, MVP зарлах.')],
    h('p', {}, `Багууд ангидаа хүлээнэ. Тоглолтоос 15 минутын өмнө менежер багаа ${PLACES.lab}-ын үүдэнд авчирна. `
      + '10 минутаас илүү хоцорвол 13:0 техникийн ялагдал.'));
}

function posters(day) {
  const [src, label] = POSTERS[day.info];
  return h('div', { class: 'sc-posters' },
    h('h2', {}, 'Зурагт хуваарь'),
    h('div', { class: 'pub-links' },
      h('a', { class: 'btn secondary', href: src, target: '_blank', rel: 'noopener' }, `${label} (PNG)`),
      h('a', { class: 'btn secondary', href: 'assets/docs/12_Huvaari.pdf', target: '_blank', rel: 'noopener' }, 'Хоёр өдөр, A3 (PDF)')));
}

export default async function render(root, params = {}) {
  const clock = makeClock();
  const q = (params && params.query) || {};
  let dayIdx = q.day === '2' ? 1 : q.day === '1' ? 0 : null;
  let cur = null;
  let info = {};

  const tabs = h('div', { class: 'sc-tabs', role: 'tablist', 'aria-label': 'Өдөр сонгох' });
  const body = h('div', { class: 'sc-body', role: 'tabpanel', id: 'sc-panel' });
  clear(root);
  root.appendChild(h('div', { class: 'pub sc' },
    h('h1', {}, 'Тоглолтын хуваарь'),
    h('p', { class: 'muted' }, `Тоглолт ${PLACES.lab}-д явагдана. Нэг удаад 2 тоглолт: А станц, Б станц. `
      + `Үзэгчид ${PLACES.hall}д LED дэлгэцээр үзнэ. Цаг нь Улаанбаатарын цагаар.`),
    tabs, body));

  const drawTabs = () => {
    clear(tabs);
    DAYS.forEach((d, i) => {
      const on = i === dayIdx;
      tabs.appendChild(h('button', {
        type: 'button', role: 'tab', class: `sc-tab${on ? ' on' : ''}`, 'aria-selected': on ? 'true' : 'false',
        'aria-controls': 'sc-panel', onclick: () => { if (dayIdx !== i) { dayIdx = i; drawTabs(); drawBody(); } },
      }, h('b', {}, d.title), h('span', {}, fmtDateShort(`${d.key}T12:00:00+08:00`))));
    });
  };

  const drawBody = () => {
    if (!cur) return;
    const now = clock.now();
    const rows = mergedMatches(cur);
    const day = DAYS[dayIdx] || DAYS[0];
    clear(body);
    const note = offlineNote(info);
    if (note) body.appendChild(note);
    if (!drawPublished(cur)) {
      body.appendChild(h('p', { class: 'card pub-note' },
        'Сугалаа 10.22 (Пү) 16:00-д болно. Түүнээс өмнө багууд «А1 – А2» гэх мэт суудлаараа харагдана.'));
    }
    const nb = ubDay(now) === day.key ? nowBox(cur, rows, now) : null;
    if (nb) body.appendChild(nb);
    body.appendChild(h('p', { class: 'sc-sub' }, day.sub));
    body.appendChild(timeline(cur, rows, day, now));
    body.appendChild(legend(day));
    body.appendChild(posters(day));
  };

  const unbind = bindState(body, (state, inf) => {
    cur = state; info = inf;
    if (dayIdx == null) dayIdx = clock.now() >= tms('2026-10-25T00:00:00+08:00') ? 1 : 0;
    drawTabs();
    drawBody();
  }, clock);
  const tick = setInterval(drawBody, 30000);   // «ОДОО» тэмдгийг цаг өнгөрөхөд шинэчилнэ
  return () => { unbind(); clearInterval(tick); };
}
