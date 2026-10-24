// Шүүгчийн хуудас — #/ref/<token>
// Станцын тоглолтууд, «Эхэлсэн», оноо (±), техникийн ялагдал, нэмэлт цаг (OT), «… — Зөв үү?» баталгаа,
// интернэт тасарвал localStorage-ийн дараалал. Ерөнхий шүүгч (station null) 'final' хийнэ.
// Газрын зургийн хасалт (журам 02 §7.9): 7 газрын зураг, ээлжлэн 3 + 3 хасна, үлдсэн нэг дээр тоглоно — зөвхөн онлайн,
// нэг удаад нэг хүсэлт (дараалалд орохгүй).
// Bo3 (финал №19, 3-р байр №20; m.best_of = 3): хасах, хасах, сонгох (1-р газар), сонгох (2-р газар), хасах, хасах → үлдсэн
// нь 3-р газар. Тал: 1-р газарт нөгөө баг, 2-р газарт эхэлсэн баг сонгоно (MatchZy JSON-д, DB-д хадгалахгүй), 3-р газарт хутга.
// Газар бүрийн оноо (MR12 + OT) cs2_ref_games-ээр бүх жагсаалтаар нь илгээгдэнэ; 2 газар түрүүлсэн баг ялна.
// API-аас ирсэн өгөгдлийг ЗӨВХӨН ui.h (textContent)-ээр DOM-д оруулна.
import { refGet, refReport, refVeto, refGames, errorText } from '../api.js';
import { h, fmtTime, fmtDate, toast, teamName, stationLabel, copyText } from '../ui.js';
import { store } from '../store.js';
import {
  validScore, resolveMatches, fmtScore, srcLabel as logicSrcLabel, mapPool, mapInfo, vetoState, bestOf, seriesState,
} from '../logic.js';
import { MATCHES, GROUP_LABEL, EVENT_NAME } from '../event.js';

const TOKEN_KEY = 'cs2.ref.token';
const Q_PREFIX = 'cs2.ref.q.';
const CACHE_PREFIX = 'cs2.ref.cache.';
const SIDES_PREFIX = 'cs2.ref.sides.';
const CACHE_TTL_MS = 3 * 24 * 3600 * 1000;
const POLL_MS = 20000;
const RETRY_MS = 15000;
const KO = new Set(['qf', 'sf', 'final', 'third']);
const ACTIONS = ['live', 'report', 'final', 'games'];
const STATUS_TEXT = { scheduled: 'Эхлээгүй', live: 'Явагдаж байна', reported: 'Илгээсэн', final: 'Баталгаажсан' };

/* ================================================================== pure helpers (Node-д тестлэгдэнэ) */

export function cleanToken(raw) {
  if (raw == null) return null;
  let t = String(raw);
  try { t = decodeURIComponent(t); } catch (e) { /* түүхий утгыг үлдээнэ */ }
  t = t.trim();
  return /^[\x21-\x7E]{6,256}$/.test(t) ? t : null;
}

/** Токены богино хэш — дараалал/кэшийн түлхүүрт (токеныг өөрийг нь localStorage-д хадгалахгүй). */
export function tokenTag(token) {
  let x = 0x811c9dc5;
  let y = 0x9747b28c;
  const s = String(token || '');
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    x = Math.imul(x ^ c, 0x01000193) >>> 0;
    y = Math.imul(y ^ c, 0x5bd1e995) >>> 0;
  }
  return x.toString(16).padStart(8, '0') + y.toString(16).padStart(8, '0');
}

export const isKnockout = (stage) => KO.has(stage);
export const isDone = (m) => !!m && (m.status === 'reported' || m.status === 'final');
export const statusKey = (m) => (m && STATUS_TEXT[m.status] ? m.status : 'scheduled');

export function sortMatches(list) {
  return (list || []).slice().sort((a, b) => ((Date.parse(a.start) || 0) - (Date.parse(b.start) || 0)) || (a.no - b.no));
}

/** Одоогийн тоглолт: эхэлсэн → эхний дуусаагүй → сүүлийнх. */
export function pickCurrent(list) {
  const s = sortMatches(list);
  return s.find((m) => m.status === 'live') || s.find((m) => !isDone(m)) || s[s.length - 1] || null;
}

export function stageLabel(m) {
  if (!m) return '';
  if (m.stage === 'group') return `${GROUP_LABEL[m.grp] || m.grp || ''} хэсэг`;
  if (m.stage === 'qf') return `Шөвгийн 8 · ${m.code || ''}`;
  if (m.stage === 'sf') return `Шөвгийн 4 · ${m.code || ''}`;
  if (m.stage === 'final') return 'Финал';
  if (m.stage === 'third') return '3-р байрын тоглолт';
  return m.code || '';
}

/** 'seat:A1' → «А1», 'rank:B2' → «Б хэсгийн 2-р байр», 'W:13' → «№13 тоглолтын ялагч». */
export function srcLabel(src) {
  const s = String(src || '');
  let m = s.match(/^seat:([ABVG])([123])$/);
  if (m) return `${GROUP_LABEL[m[1]]}${m[2]}`;
  m = s.match(/^rank:([ABVG])([12])$/);
  if (m) return `${GROUP_LABEL[m[1]]} хэсгийн ${m[2]}-р байр`;
  m = s.match(/^W:(\d+)$/);
  if (m) return `№${m[1]} тоглолтын ялагч`;
  m = s.match(/^L:(\d+)$/);
  if (m) return `№${m[1]} тоглолтын ялагдагч`;
  return '?';
}

/** Тодорхойгүй талын нэр: logic.srcLabel (зурагт хуудастай ижил), алдаа гарвал дотоод хувилбар. */
export function sourceText(src) {
  let t = '';
  try { t = logicSrcLabel(src, { long: true }); } catch (e) { t = ''; }
  return t || srcLabel(src);
}

export function scoreHint(stage) {
  return KO.has(stage)
    ? 'Хасагдах шат: 13 : 0–11. Нэмэлт цагтай бол 16 : 12–14, 19 : 15–17 гэх мэт.'
    : 'Хэсгийн шат: ялагч 13, ялагдагч 0–11 оноотой. Эсвэл 12 : 12 тэнцээ.';
}

function logicValid(stage, a, b, forfeit) {
  try {
    const v = validScore(stage, a, b, forfeit || null);
    return v === true || (!!v && typeof v === 'object' && v.ok === true);
  } catch (e) { return false; }
}

/** logic.validScore + UI-ийн OT тэмдэглэгээний уялдаа. */
export function checkScore(stage, a, b, forfeit, ot) {
  if (forfeit) return logicValid(stage, a, b, forfeit) ? { ok: true } : { ok: false, msg: 'Техникийн ялагдал 13 : 0 байна.' };
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return { ok: false, msg: 'Хоёр багийн оноог оруулна уу.' };
  if (KO.has(stage) && ot && Math.max(a, b) < 16) return { ok: false, msg: 'Нэмэлт цагтай бол ялагч 16, 19, 22… оноотой байна.' };
  if (logicValid(stage, a, b, null)) return { ok: true };
  return { ok: false, msg: scoreHint(stage) };
}

/* ---------- Bo3 цуврал (финал, 3-р байр) */

/** Bo3 цуврал уу (logic.bestOf: DB-ийн best_of = 3). */
export function isBo3(m) {
  try { return bestOf(m) === 3; } catch (e) { return false; }
}

const isScore = (v) => Number.isInteger(v) && v >= 0 && v <= 99;

/** cs2_ref_games-ийн ачаалал: 0–3 газар, газар бүр {a, b} бүхэл тоо. */
export function validGames(games) {
  return Array.isArray(games) && games.length <= 3 && games.every((g) => !!g && isScore(g.a) && isScore(g.b));
}

/** «13:9 · 9:13 · 13:11» (жагсаалт, дараалал, баталгаажуулалтад). */
export function gamesText(games) {
  return (Array.isArray(games) ? games : []).map((g) => `${g.a}:${g.b}`).join(' · ');
}

/**
 * Цувралын бүх газрыг шалгана (сервер мөн шалгана): газар бүр хасагдах шатны оноо (MR12 + OT, тэнцээгүй), 2 газар
 * түрүүлж хожсоны дараа газар байхгүй. bad = буруу газрын дугаар (1-ээс).
 */
export function checkSeries(stage, games) {
  const list = Array.isArray(games) ? games : [];
  let wonA = 0;
  let wonB = 0;
  if (list.length > 3) return { ok: false, bad: 4, msg: 'Цуврал хамгийн ихдээ 3 газар.', wonA, wonB, decided: false, winner: null };
  for (let i = 0; i < list.length; i++) {
    const g = list[i];
    if (wonA === 2 || wonB === 2) {
      return { ok: false, bad: i + 1, msg: `Цуврал ${i}-р газарт шийдэгдсэн тул ${i + 1}-р газар тоглогдохгүй.`, wonA, wonB, decided: true, winner: wonA === 2 ? 'a' : 'b' };
    }
    if (!g || !isScore(g.a) || !isScore(g.b) || g.a === g.b || !logicValid(stage, g.a, g.b, null)) {
      return { ok: false, bad: i + 1, msg: `${i + 1}-р газар: ${scoreHint(stage)}`, wonA, wonB, decided: false, winner: null };
    }
    if (g.a > g.b) wonA += 1; else wonB += 1;
  }
  const decided = wonA === 2 || wonB === 2;
  return { ok: true, bad: null, msg: '', wonA, wonB, decided, winner: decided ? (wonA === 2 ? 'a' : 'b') : null };
}

/**
 * n-р газрыг (1-ээс) a:b болгосон бүтэн жагсаалт: өмнөх газрууд хэвээр, шинэ дүнгээр цуврал эрт шийдэгдвэл дараагийн
 * газрууд хасагдана (dropped — баталгаажуулах цонхонд хэлнэ). n нь 1…(газрын тоо + 1), ≤ 3 биш бол null.
 */
export function setGame(games, n, a, b) {
  const list = (Array.isArray(games) ? games : []).map((g) => ({ a: g.a, b: g.b }));
  if (!Number.isInteger(n) || n < 1 || n > 3 || n > list.length + 1) return null;
  list[n - 1] = { a, b };
  let wonA = 0;
  let wonB = 0;
  let cut = list.length;
  for (let i = 0; i < list.length; i++) {
    if (list[i].a > list[i].b) wonA += 1; else if (list[i].b > list[i].a) wonB += 1;
    if (wonA === 2 || wonB === 2) { cut = i + 1; break; }
  }
  return { games: list.slice(0, cut), dropped: list.length - cut };
}

/**
 * Газрын табууд (logic.seriesState-ээс): 1, 2 үргэлж; 3-р газар 1 : 1 болсон (эсвэл аль хэдийн оноотой) үед.
 * enabled: дараалал алгасахгүй (n ≤ тоглосон + 1), шийдэгдсэн цувралд шинэ газар нэмэхгүй.
 */
export function gameTabs(s) {
  const games = (s && Array.isArray(s.games)) ? s.games : [];
  const maps = (s && Array.isArray(s.maps)) ? s.maps : [];
  const show3 = games.length >= 3 || (!!s && s.wonA === 1 && s.wonB === 1);
  const out = [];
  for (let n = 1; n <= (show3 ? 3 : 2); n++) {
    const g = games[n - 1] || null;
    out.push({
      n, map: (g && g.map) || maps[n - 1] || null, a: g ? g.a : null, b: g ? g.b : null, played: !!g,
      enabled: n <= games.length + 1 && !(!!s && s.decided && n > games.length),
    });
  }
  return out;
}

/** Анхдагч таб: шийдэгдсэн бол сүүлийн газар, эс бөгөөс тоглогдож буй (дараагийн) газар. */
export function defaultGame(s) {
  const n = (s && Array.isArray(s.games)) ? s.games.length : 0;
  return s && s.decided ? Math.max(1, n) : Math.min(3, n + 1);
}

const otherOf = (s) => (s === 'a' ? 'b' : 'a');

/** Тал сонгох баг (стандарт): 1-р газар (эхэлсэн багийн сонголт) — нөгөө баг, 2-р газар — эхэлсэн баг; 3-р газар хутга (null). */
export function sideChooser(first, game) {
  if (first !== 'a' && first !== 'b') return null;
  return game === 1 ? otherOf(first) : game === 2 ? first : null;
}

/** MatchZy map_sides утга: team1 = team_a (хуваарьт эхэнд бичигдсэн), team2 = team_b. */
export function matchzySide(chooser, choice) {
  if ((chooser !== 'a' && chooser !== 'b') || (choice !== 'ct' && choice !== 't')) return null;
  return `${chooser === 'a' ? 'team1' : 'team2'}_${choice}`;
}

/**
 * MatchZy Bo3 JSON-ий мөрүүд (бэлдсэн final_A.json / 3-r-bair_B.json-д ижил нэртэй мөрийг солино). Сонгоогүй тал
 * «<choose>» — таахгүй; ийм JSON-ийг MatchZy ачаалахгүй. choices = {1: 'ct'|'t', 2: 'ct'|'t'}.
 */
export function bo3JsonLines(maps, first, choices) {
  const ids = [0, 1, 2].map((i) => (maps && maps[i] ? mapInfo(maps[i]).id : '<map>'));
  const sides = [1, 2].map((g) => matchzySide(sideChooser(first, g), choices && choices[g]) || '<choose>');
  return [
    '"num_maps": 3,',
    `"maplist": ["${ids.join('", "')}"],`,
    `"map_sides": ["${sides[0]}", "${sides[1]}", "knife"],`,
    '"clinch_series": true,',
  ];
}

/** Дараалал/алдааны жагсаалтын мөр (Bo1-ийн мөр өмнөхтэй яг ижил). */
export function entryText(e) {
  if (!e) return '';
  if (e.action === 'live') return `№${e.no}: эхэлсэн`;
  if (e.action === 'games') {
    const g = Array.isArray(e.games) ? e.games : [];
    return `№${e.no}: ${g.length ? `газрууд ${gamesText(g)}` : 'газрын оноог устгах'}`;
  }
  if (e.a == null || e.b == null) return `№${e.no}: ${e.forfeit ? 'техникийн ялагдал (цуврал 2 : 0)' : 'цувралын дүн'}${e.action === 'final' ? ' — эцсийн' : ''}`;
  return `№${e.no}: ${e.a} : ${e.b}${e.forfeit ? ' (техникийн)' : ''}${e.action === 'final' ? ' — эцсийн' : ''}`;
}

export function validEntry(e) {
  return !!e && typeof e.id === 'string' && Number.isInteger(e.no) && ACTIONS.includes(e.action)
    && (e.action !== 'games' || validGames(e.games));
}

/**
 * Дараалалд нэмнэ: шинэ 'report' нь ижил тоглолтын хуучин 'report'-ыг, шинэ 'final' нь хуучин 'final'-ыг, шинэ 'games'
 * (Bo3-ийн бүтэн жагсаалт) нь хуучин 'games'-ийг орлоно — хамгийн сүүлийн жагсаалт ялна.
 */
export function enqueueEntry(queue, entry) {
  let q = (queue || []).filter(validEntry);
  if (entry.action === 'live') {
    if (q.some((x) => x.no === entry.no)) return q;
  } else {
    q = q.filter((x) => !(x.no === entry.no && x.action === entry.action));
  }
  q.push(entry);
  return q;
}

/** Серверийн тоглолтууд дээр илгээгдээгүй үйлдлийг давхарлан харуулна (pending тоо нэмнэ). */
export function applyQueue(matches, queue) {
  const by = new Map();
  for (const e of queue || []) if (validEntry(e)) by.set(e.no, (by.get(e.no) || []).concat([e]));
  return (matches || []).map((m) => {
    const es = by.get(m.no);
    if (!es) return m;
    const out = { ...m, pending: es.length };
    for (const e of es) {
      if (e.action === 'live') { if (!isDone(out)) out.status = 'live'; } else if (e.action === 'games') {
        // Bo3: газрууд (газрын нэр серверийнхээс эсвэл m.maps-аас); шийдэгдвэл 'reported' + цувралын оноо, үгүй бол 'live'
        const prev = Array.isArray(out.games) ? out.games : [];
        const maps = Array.isArray(m.maps) ? m.maps : [];
        out.games = e.games.map((g, i) => ({ a: g.a, b: g.b, map: (prev[i] && prev[i].map) || maps[i] || null }));
        const t = checkSeries(m.stage, out.games);
        out.forfeit = null;
        out.ot = false;
        if (t.ok && t.decided) {
          if (out.status !== 'final') out.status = 'reported';
          out.score_a = t.wonA;
          out.score_b = t.wonB;
        } else {
          if (out.status !== 'final') out.status = 'live';
          out.score_a = null;
          out.score_b = null;
        }
      } else if (isBo3(m)) {
        // Bo3: 'report' = цувралын техникийн ялагдал (2 : 0), 'final' = шийдэгдсэн цувралыг батлах (оноо илгээхгүй)
        out.status = e.action === 'final' ? 'final' : 'reported';
        if (e.forfeit) {
          out.forfeit = e.forfeit;
          out.score_a = e.forfeit === 'a' ? 0 : 2;
          out.score_b = e.forfeit === 'a' ? 2 : 0;
          out.games = [];
          out.ot = false;
        }
      } else {
        out.status = e.action === 'final' ? 'final' : 'reported';
        out.score_a = e.a;
        out.score_b = e.b;
        out.forfeit = e.forfeit || null;
        out.ot = !e.forfeit && KO.has(m.stage) && Math.max(e.a, e.b) >= 16;
      }
    }
    return out;
  });
}

/** Түр зуурын (дахин оролдох) алдаа уу? api.rpc нь 'network' | 'http_<status>' шиднэ. */
export function isTransient(err) {
  const msg = String((err && err.message) || '');
  return msg === 'network' || /^http_(5\d\d|408|425|429)$/.test(msg);
}

/* ---------- map veto */
const VETO_KEYS = ['veto_first', 'veto_coin', 'veto', 'map', 'maps'];
export const VETO_OFF_TEXT = 'Газрын зургийн систем хараахан идэвхжээгүй байна. Зохион байгуулагчид хэлнэ үү.';

/** RPC байхгүй (DB шилжилт хийгдээгүй): PostgREST 404 → api.rpc 'http_404' шиднэ. */
export function isMissingRpc(err) { return String((err && err.message) || '') === 'http_404'; }

/** Шүүгч энэ тоглолтын хасалтыг хийж чадах уу: станцын шүүгч — өөрийн станц, 'scheduled'|'live'; ерөнхий — 'final'-аас бусад. */
export function vetoAccess(m, ref) {
  if (!m || m.status === 'final') return { can: false, chief: false, reason: 'final' };
  const chief = !!(ref && ref.chief);
  // Bo3: газрын оноо орсон бол газрын жагсаалтыг зөвхөн админ өөрчилнө (сервер: forbidden games_started)
  if (isBo3(m) && Array.isArray(m.games) && m.games.length) return { can: false, chief, reason: 'games_started' };
  if (!chief && ref && ref.station && m.station && m.station !== ref.station) return { can: false, chief, reason: 'other_station' };
  if (!chief && m.status !== 'scheduled' && m.status !== 'live') return { can: false, chief, reason: 'already_reported' };
  return { can: true, chief, reason: null };
}

/** Серверийн тоглолтоос зөвхөн хасалтын талбарууд (хуучин DB-д байхгүй бол хоосон объект). */
export function vetoFields(src) {
  const o = {};
  for (const k of VETO_KEYS) if (src && typeof src === 'object' && k in src) o[k] = src[k];
  return o;
}

/** №no тоглолтод хасалтын талбаруудыг нэгтгэсэн шинэ жагсаалт. */
export function mergeVeto(matches, no, fields) {
  return (matches || []).map((m) => (m && m.no === no ? { ...m, ...fields } : m));
}

/**
 * Хавтан бүр: {key, name, ban:{side, order}|null, play, pick:{side, game}|null, decider} — pool-ийн дарааллаар.
 * order = хэд дэх хасалт. Bo3: сонгосон газар pick (game 1 | 2), үлдсэн нь decider (3-р газар), play үргэлж false.
 */
export function vetoTiles(v, pool) {
  const acts = (v && Array.isArray(v.acts)) ? v.acts : [];
  const ban = new Map();
  const pick = new Map();
  ((v && v.steps) || []).forEach((s, i) => {
    if (acts[i] === 'pick') pick.set(s.map, { side: s.side, game: pick.size + 1 });
    else ban.set(s.map, { side: s.side, order: ban.size + 1 });
  });
  const bo3 = !!v && v.bo === 3;
  const keys = Array.isArray(pool) && pool.length ? pool : [...((v && v.steps) || []).map((s) => s.map), ...((v && v.remaining) || [])];
  return keys.map((key) => ({
    key, name: mapInfo(key).name, ban: ban.get(key) || null, play: !bo3 && !!(v && v.done && v.map === key),
    pick: pick.get(key) || null, decider: bo3 && !!(v && v.done && v.remaining && v.remaining[0] === key),
  }));
}

/** «Багш нарын баг» → «Багш нар» (хавтан дээрх богино нэр). */
export function shortTeam(name) { return String(name || '').replace(/ нарын баг$/u, ' нар'); }

/** Серверийн консолын команд: «changelevel de_mirage». */
export function serverCmd(key) { return `changelevel ${mapInfo(key).id}`; }

/** MatchZy match JSON-ий мөр: «"maplist": ["de_mirage"]» (техникийн ахлагч matchzy_loadmatch-аас өмнө засна, admin-тай ижил). */
export function maplistCmd(key) { return `"maplist": ["${mapInfo(key).id}"]`; }

/**
 * «Хасах» хүсэлт: step (харсан хасалтын тоо) + side (дэлгэц дээр «… хасна» гэж харуулсан тал). Зоосыг өөр
 * төхөөрөмж сольсон бол сервер 'stale' буцаана — хасалт нөгөө багийнх болж бичигдэхгүй.
 */
export function vetoBanArgs(v, map) { return { map, step: v.steps.length, side: v.next ? v.next.side : null }; }

/** Энэ алхмын үйлдэл: 'pick' (Bo3-ийн 3, 4-р алхам) эсвэл 'ban'. */
export function vetoAct(v) { return v && v.nextAct === 'pick' ? 'pick' : 'ban'; }

/**
 * Дууссан хасалтыг товч (газрын зураг + команд) харуулах уу. Явагдаж буй хасалт — үгүй (бүтэн самбар).
 * Дууссан — анхдагчаар товч, харин энэ тоглолтын ижил төлөвт хадгалсан нээлттэй харагдац байвал бүтэн
 * (энэ төхөөрөмжийн сүүлийн хасалтын дараа эсвэл «Хасалтыг харах»). view = {no, status, open}.
 */
export function vetoCollapsed(v, m, view) {
  if (!v || !v.done) return false;
  return !(view && m && view.no === m.no && view.status === m.status && view.open);
}

/** cs2_ref_veto алдааны монгол тайлбар. */
export function vetoErrorText(r) {
  const code = r && r.error;
  if (code === 'forbidden') {
    const reason = {
      final: 'Дүн баталгаажсан тул газрын зургийг өөрчлөхгүй.',
      already_reported: 'Оноо илгээсэн тул зөвхөн ерөнхий шүүгч өөрчилнө.',
      group_fixed: 'Хэсгийн шатанд эхэнд бичигдсэн баг эхэлж хасна.',
      veto_started: 'Хасалт эхэлсэн тул зоосыг өөрчлөхгүй.',
      first_set: 'Зоосыг аль хэдийн шидсэн байна. Буруу бол ерөнхий шүүгч шинээр эхлүүлнэ.',
      chief_only: 'Үүнийг зөвхөн ерөнхий шүүгч хийнэ.',
      first_missing: 'Эхлээд зоос шидэж, хэн эхэлж хасахыг шийднэ үү.',
      veto_done: 'Хасалт аль хэдийн дууссан.',
      veto_empty: 'Буцаах хасалт алга.',
      other_station: 'Энэ тоглолт өөр станцынх.',
      games_started: 'Газрын оноо орсон тул газрын зургийн сонголтыг өөрчлөхгүй. Шаардлагатай бол зохион байгуулагч засна.',
      pool_small: 'Bo3-д дор хаяж 5 газрын зураг хэрэгтэй. Зохион байгуулагчид хэлнэ үү.',
    }[r.reason];
    return reason || 'Энэ үйлдлийг хийх эрхгүй.';
  }
  if (code === 'stale' && (r.act === 'pick' || r.act === 'ban')) {
    return `${errorText(r)} Энэ алхамд газрын зураг ${r.act === 'pick' ? 'сонгоно' : 'хасна'}.`;
  }
  if (code === 'validation') {
    const e = (Array.isArray(r.errors) && r.errors[0]) || {};
    if (e.field === 'map' && e.code === 'taken') return 'Энэ газрын зураг аль хэдийн хасагдсан эсвэл сонгогдсон.';
    if (e.field === 'map') return 'Газрын зураг буруу байна.';
    if (e.field === 'side') return 'Эхлэх баг буруу байна.';
    return 'Мэдээлэл буруу байна. Ерөнхий шүүгчид хэлнэ үү.';
  }
  if (code === 'not_found') return 'Тоглолт олдсонгүй.';
  return errorText(r);
}

export const _test = {
  cleanToken, tokenTag, isKnockout, isDone, statusKey, sortMatches, pickCurrent, stageLabel, srcLabel, sourceText, scoreHint,
  checkScore, validEntry, enqueueEntry, applyQueue, isTransient,
  isMissingRpc, vetoAccess, vetoFields, mergeVeto, vetoTiles, shortTeam, serverCmd, maplistCmd, vetoBanArgs, vetoCollapsed, vetoErrorText,
  isBo3, validGames, gamesText, checkSeries, setGame, gameTabs, defaultGame, sideChooser, matchzySide, bo3JsonLines, entryText, vetoAct,
};

/* ================================================================== storage & modal */

function storageOf(kind) { try { return kind === 'local' ? window.localStorage : window.sessionStorage; } catch (e) { return null; } }
function sGet(kind, key) { try { const s = storageOf(kind); return s ? s.getItem(key) : null; } catch (e) { return null; } }
function sSet(kind, key, val) { try { const s = storageOf(kind); if (!s) return false; s.setItem(key, val); return true; } catch (e) { return false; } }
function sDel(kind, key) { try { const s = storageOf(kind); if (s) s.removeItem(key); } catch (e) { /* ignore */ } }

function takeToken(arg, key, routeHash) {
  const fromUrl = cleanToken(arg);
  if (arg) { try { history.replaceState(null, '', routeHash); } catch (e) { /* ignore */ } }
  if (fromUrl) { sSet('session', key, fromUrl); return fromUrl; }
  return cleanToken(sGet('session', key));
}

function empty(el) { while (el && el.firstChild) el.removeChild(el.firstChild); return el; }
/** Null-safe append (native Element.append would print «null»). */
function add(el, ...kids) { for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k); return el; }

const openModals = new Set();
function focusables(box) {
  return Array.from(box.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
}
function openModal({ title, body, actions, dismissable = true, onClose, className }) {
  const prev = document.activeElement;
  const titleId = `ops-mt-${Math.random().toString(36).slice(2, 9)}`;
  const box = h('div', { class: `ops-modal-box${className ? ` ${className}` : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' },
    h('h2', { class: 'ops-modal-title', id: titleId }, title),
    h('div', { class: 'ops-modal-body' }, body),
    actions && actions.length ? h('div', { class: 'ops-modal-actions' }, actions) : null);
  const overlay = h('div', { class: 'ops-modal' }, box);
  const api = { closed: false, dismissable, box, close };
  overlay.addEventListener('click', (e) => { if (e.target === overlay && api.dismissable) close('backdrop'); });
  const onKey = (e) => {
    if (Array.from(openModals).pop() !== api) return;
    if (e.key === 'Escape' && api.dismissable) { e.preventDefault(); close('esc'); return; }
    if (e.key === 'Tab') {
      const f = focusables(box);
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === box)) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  document.body.classList.add('ops-noscroll');
  openModals.add(api);
  setTimeout(() => { const f = box.querySelector('[data-autofocus]:not([disabled])') || box; try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 30);
  function close(reason) {
    if (api.closed) return;
    api.closed = true;
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    openModals.delete(api);
    if (!openModals.size) document.body.classList.remove('ops-noscroll');
    if (prev && typeof prev.focus === 'function' && document.contains(prev)) { try { prev.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    if (onClose) onClose(reason);
  }
  return api;
}
function closeAllModals() { for (const m of Array.from(openModals)) m.close('cleanup'); }

/* ================================================================== page */

export default async function render(root, params) {
  const page = createRefPage(root, params || {});
  page.start();
  return page.destroy;
}

function createRefPage(root, params) {
  const S = {
    dead: false, token: null, tag: null, ref: null, sel: null, filter: 'all', edits: new Map(), q: [], qVolatile: false,
    failures: [], resolved: new Map(), resolvedFp: '', names: {}, busy: false, flushing: false, loading: false,
    netError: false, fromCache: false, timers: {}, unsub: null, fp: { list: '', detail: '' }, offset: 0,
    // хасалт: илгээж буй эсэх, сонгосон хавтан {no, map, step}, RPC байхгүй, сүүлийн амжилттай хариу (no → {at, fields}), дахин ачаалах,
    // дууссан хасалтын харагдац {no, status, open} (өөр тоглолт эсвэл төлөв өөрчлөгдвөл анхдагч — товч)
    vetoBusy: false, vetoSel: null, vetoOff: false, vetoPatch: new Map(), again: false, vetoView: null,
    // Bo3: сонгосон газрын таб (no → 1…3), MatchZy-ийн талын сонголт (no → {fp, 1, 2}; энэ төхөөрөмжид л, DB-д биш)
    gameSel: new Map(), sides: null,
  };
  const el = { quick: {}, score: {} };
  const prevTitle = document.title;

  /* ---------- lifecycle ---------- */
  async function start() {
    S.token = takeToken(params.arg, TOKEN_KEY, '#/ref');
    if (!S.token) { renderNoToken(); return; }
    S.tag = tokenTag(S.token);
    S.q = readQueue();
    document.title = `Шүүгч · ${EVENT_NAME}`;
    const c = readCache();
    if (c) {
      S.ref = c.ref;
      S.names = c.names || {};
      S.resolved = new Map(Array.isArray(c.resolved) ? c.resolved : []);
      S.fromCache = true;
    }
    updateResolved();
    renderFrame();
    if (S.ref) renderAll(true); else el.detail.append(h('p', { class: 'muted loading' }, 'Ачаалж байна…'));
    S.unsub = store.subscribe(() => { if (updateResolved() && S.ref && !S.dead) renderAll(); });
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibility);
    S.timers.poll = setInterval(() => { if (!document.hidden) load(true); }, POLL_MS);
    S.timers.retry = setInterval(() => { if (S.q.length) flush(); }, RETRY_MS);
    S.timers.clock = setInterval(updateLateNote, 30000);
    await load(true);
    flush();
  }

  function destroy() {
    if (S.dead) return;
    S.dead = true;
    for (const t of Object.values(S.timers)) clearInterval(t);
    if (S.unsub) { S.unsub(); S.unsub = null; }
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    document.removeEventListener('visibilitychange', onVisibility);
    closeAllModals();
    document.title = prevTitle;
  }

  function onOnline() { S.netError = false; renderHead(); flush(); load(true); }
  function onOffline() { renderHead(); }
  function onVisibility() { if (!document.hidden) { load(true); flush(); } }

  function invalidate(code) {
    sDel('session', TOKEN_KEY);
    sDel('local', cacheKey());
    S.token = null;
    for (const t of Object.values(S.timers)) clearInterval(t);
    closeAllModals();
    renderFatal(code);
  }

  /* ---------- data ---------- */
  async function load(background, manual) {
    if (S.loading || S.dead || !S.token) return;
    S.loading = true;
    const t0 = Date.now();
    let r = null;
    let err = null;
    try { r = await refGet(S.token); } catch (x) { err = x; }
    S.loading = false;
    if (S.dead) return;
    if (S.again) { S.again = false; setTimeout(() => load(true), 0); }   // хасалтын дараа шинэ төлөв хэрэгтэй
    if (err) {
      S.netError = true;
      if (!S.ref) renderFatal('network');
      else { renderHead(); if (manual) toast('Холболт алга. Хадгалсан мэдээллийг харуулж байна.', 'warn'); }
      return;
    }
    if (!r || !r.ok) {
      const code = r && r.error;
      if (code === 'bad_token' || code === 'expired') { invalidate(code); return; }
      if (!S.ref) renderFatal(code || 'unknown', r); else if (!background) toast(errorText(r), 'err');
      return;
    }
    S.netError = false;
    S.fromCache = false;
    patchVeto(r, t0);
    S.ref = r;
    if (r.now) { const t = Date.parse(r.now); if (!Number.isNaN(t)) S.offset = t - Date.now(); }
    updateResolved();
    writeCache();
    if (!el.head || !root.contains(el.head)) renderFrame();
    renderAll(!!manual);
    if (manual) toast('Шинэчлэгдлээ', 'ok', 1500);
  }

  /** Хасалтаас өмнө эхэлсэн ачаалал хуучин төлөв авчирч болно → сүүлийн амжилттай хасалтын хариуг давхарлана. */
  function patchVeto(r, t0) {
    for (const [no, p] of S.vetoPatch) {
      if (p.at <= t0) { S.vetoPatch.delete(no); continue; }
      const x = Array.isArray(r.matches) ? r.matches.find((mm) => mm && mm.no === no) : null;
      if (x) Object.assign(x, p.fields);
    }
  }
  function reload() { if (S.loading) S.again = true; else load(true); }

  /** Багуудыг logic-оор тодорхойлно: нийтийн төлөв + энэ шүүгчийн шүүлтгүй (120 с хүлээлтгүй) дүнгүүд. */
  function updateResolved() {
    const st = store.get();
    if (!st) return false;
    let state = st;
    const own = S.ref && Array.isArray(S.ref.matches) ? S.ref.matches : null;
    if (own && own.length && Array.isArray(st.matches)) {
      const byNo = new Map(own.map((m) => [m.no, m]));
      state = { ...st, matches: st.matches.map((m) => byNo.get(m.no) || m) };
    }
    const res = new Map();
    try {
      for (const m of resolveMatches(state, { official: true }) || []) {
        res.set(m.no, { a: m.team_a == null ? null : m.team_a, b: m.team_b == null ? null : m.team_b });
      }
    } catch (e) { /* logic алдаа: эх сурвалжийн нэрээр үргэлжилнэ */ }
    const names = {};
    for (const t of st.teams || []) names[t.id] = t.name;
    const fp = JSON.stringify([Array.from(res.entries()), names]);
    if (fp === S.resolvedFp) return false;
    S.resolvedFp = fp;
    S.resolved = res;
    S.names = names;
    writeCache();
    return true;
  }

  /* ---------- cache & queue (localStorage, токены хэшээр) ---------- */
  function cacheKey() { return CACHE_PREFIX + S.tag; }
  function readCache() {
    try {
      const c = JSON.parse(sGet('local', cacheKey()) || 'null');
      if (!c || !c.ref || !Array.isArray(c.ref.matches) || !(Date.now() - Number(c.at || 0) < CACHE_TTL_MS)) return null;
      return c;
    } catch (e) { return null; }
  }
  function writeCache() {
    if (!S.ref || !S.tag || !S.token) return;
    sSet('local', cacheKey(), JSON.stringify({ at: Date.now(), ref: S.ref, names: S.names, resolved: Array.from(S.resolved.entries()) }));
  }
  function qKey() { return Q_PREFIX + S.tag; }
  function readQueue() {
    try { const v = JSON.parse(sGet('local', qKey()) || '[]'); return Array.isArray(v) ? v.filter(validEntry) : []; } catch (e) { return []; }
  }
  function persistQ() {
    if (S.q.length) S.qVolatile = !sSet('local', qKey(), JSON.stringify(S.q));
    else { sDel('local', qKey()); S.qVolatile = false; }
  }
  function queueAdd(entry) { S.q = enqueueEntry(S.q, entry); persistQ(); }

  /** Нэг үйлдлийг сервер рүү: Bo3-ийн газрууд — cs2_ref_games (бүтэн жагсаалт), бусад — cs2_ref_report. */
  function callEntry(e) {
    return e.action === 'games' ? refGames(S.token, e.no, e.games) : refReport(S.token, e.no, e.action, e.a, e.b, e.forfeit, e.ta, e.tb);
  }

  async function flush(manual) {
    if (S.flushing || S.dead || !S.q.length || !S.token) return;
    S.flushing = true;
    renderHead();
    let sent = 0;
    let stopped = false;
    while (S.q.length && !S.dead && S.token) {
      const e = S.q[0];
      let r = null;
      let err = null;
      try { r = await callEntry(e); } catch (x) { err = x; }
      if (S.dead) return;
      if (err && isTransient(err)) { stopped = true; S.netError = true; break; }
      S.q = S.q.filter((x) => x.id !== e.id);
      persistQ();
      if (r && r.ok) { sent += 1; continue; }
      if (r && (r.error === 'bad_token' || r.error === 'expired')) { S.flushing = false; invalidate(r.error); return; }
      S.failures.push({ no: e.no, action: e.action, text: err ? `Илгээж чадсангүй (${err.message}).` : reportErrorText(r) });
    }
    S.flushing = false;
    if (!stopped) S.netError = false;
    if (sent) { toast(`Дараалалд байсан ${sent} илгээлт амжилттай.`, 'ok'); await load(true); return; }
    if (manual && stopped) toast('Холболт алга. Дараа автоматаар дахин оролдоно.', 'warn');
    renderAll(true);
  }

  /* ---------- derived ---------- */
  function effective() { return applyQueue((S.ref && S.ref.matches) || [], S.q); }
  function filtered(list) {
    if (!S.ref || !S.ref.chief || S.filter === 'all') return list;
    return list.filter((m) => m.station === S.filter);
  }
  function currentMatch() { return effective().find((m) => m.no === S.sel) || null; }

  function nameOf(id) {
    const st = store.get();
    if (st) { const n = teamName(st, id); if (n && n !== '—') return n; }
    const t = S.ref && Array.isArray(S.ref.teams) ? S.ref.teams.find((x) => x && x.id === id) : null;
    return (t && t.name) || (S.names && S.names[id]) || `Баг ${id}`;
  }
  function side(m, s) {
    const stored = m[`team_${s}`];
    const res = S.resolved.get(m.no);
    const id = stored != null ? stored : (res && res[s] != null ? res[s] : null);
    if (id != null) return { id, name: nameOf(id), known: true };
    const ev = (MATCHES || []).find((x) => x.no === m.no);
    return { id: null, name: ev ? sourceText(ev[`src_${s}`]) : '?', known: false };
  }
  const sideName = (m, s) => side(m, s).name;

  function editFor(m) {
    const fp = JSON.stringify([m.status, m.score_a, m.score_b, m.forfeit, m.ot]);
    let e = S.edits.get(m.no);
    if (!e || (!e.touched && e.fp !== fp)) {
      const has = m.score_a != null && m.score_b != null;
      e = {
        a: has ? m.score_a : 0, b: has ? m.score_b : 0, forfeit: has ? (m.forfeit || null) : null,
        ot: !!m.ot || (has && KO.has(m.stage) && Math.max(m.score_a, m.score_b) >= 16), touched: false, fp,
      };
      S.edits.set(m.no, e);
    }
    return e;
  }

  function scoreText(m) {
    if (m.score_a == null || m.score_b == null) return '';
    try { return fmtScore(m); } catch (e) { return `${m.score_a} : ${m.score_b}`; }
  }

  function reportErrorText(r) {
    const code = r && r.error;
    if (code === 'invalid_score') {
      if (r.reason === 'undecided') return 'Цуврал шийдэгдээгүй байна: 3 газрын зургаас 2-т түрүүлж хожсон баг ялна.';
      if (r.reason === 'series') return 'Цувралын оноо дүрэмд нийцэхгүй: 2 газрын зураг хожсоны дараа газар тоглогдохгүй.';
      return r.game ? errorText(r) : 'Оноо дүрэмд нийцэхгүй байна.';
    }
    if (code === 'forbidden') {
      if (r.reason === 'other_station') return 'Энэ тоглолт өөр станцынх.';
      if (r.reason === 'already_reported') return 'Оноо аль хэдийн илгээгдсэн байна.';
      if (r.reason === 'chief_only') return 'Баталгаажсан дүнг зөвхөн ерөнхий шүүгч өөрчилнө.';
      return 'Энэ тоглолтыг өөрчлөх эрхгүй.';
    }
    if (code === 'validation') return 'Мэдээлэл буруу байна. Ерөнхий шүүгчид хэлнэ үү.';
    if (code === 'draw_state') return 'Сугалаа нийтлэгдээгүй тул оноо оруулах боломжгүй.';
    if (code === 'not_found') return 'Тоглолт олдсонгүй.';
    return errorText(r);
  }

  /* ---------- render ---------- */
  function renderNoToken() {
    empty(root);
    root.appendChild(h('section', { class: 'card k-empty' },
      h('div', { class: 'k-empty-ico', 'aria-hidden': 'true' }, '▣'),
      h('h1', {}, 'Шүүгчийн QR кодоо уншуулна уу'),
      h('p', {}, 'Шүүгчийн хуудас зөвхөн тусгай холбоосоор нээгдэнэ.'),
      h('p', {}, 'Холбоосыг зохион байгуулагчаас авна уу.'),
      h('a', { class: 'btn secondary', href: '#/' }, 'Нүүр хуудас')));
  }

  function renderFatal(code, r) {
    if (S.dead) return;
    empty(root);
    let title = 'Алдаа гарлаа';
    let text = errorText(r || { error: code });
    let retry = true;
    if (code === 'network') { title = 'Холболт амжилтгүй'; text = 'Интернэтээ шалгаад дахин оролдоно уу.'; }
    if (code === 'bad_token') { title = 'Холбоос хүчингүй байна'; text = 'Зохион байгуулагчаас шинэ QR код авна уу.'; retry = false; }
    if (code === 'expired') { title = 'Холбоос идэвхгүй байна'; text = 'Шүүгчийн холбоос 10.24 07:00 – 10.25 20:00 хооронд ажиллана.'; retry = false; }
    const pending = S.q.slice();
    root.appendChild(h('section', { class: 'card error k-fatal', role: 'alert' },
      h('h1', {}, title), h('p', {}, text),
      pending.length ? h('div', { class: 'r-lost' },
        h('p', {}, h('b', {}, `Илгээгдээгүй ${pending.length} үйлдэл байна. Зохион байгуулагчид хэлнэ үү:`)),
        h('ul', {}, pending.map((e) => h('li', {}, entryText(e))))) : null,
      h('div', { class: 'row' },
        retry ? h('button', { type: 'button', class: 'btn', onclick: () => { renderFrame(); el.detail.append(h('p', { class: 'muted loading' }, 'Ачаалж байна…')); load(false); } }, 'Дахин оролдох') : null,
        h('a', { class: 'btn secondary', href: '#/' }, 'Нүүр хуудас'))));
  }

  function renderFrame() {
    empty(root);
    el.head = h('header', { class: 'card r-head' });
    el.fail = h('div', { class: 'card error r-fail', role: 'alert', hidden: true });
    el.detail = h('section', { class: 'card r-detail', 'aria-labelledby': 'r-detail-h' });
    el.filter = h('div', { class: 'r-filter', role: 'group', 'aria-label': 'Станцаар шүүх', hidden: true });
    el.list = h('nav', { class: 'r-matches', 'aria-label': 'Тоглолтууд' });
    root.append(el.head, el.fail, el.detail, el.filter, el.list);
    S.fp = { list: '', detail: '' };
    renderHead();
  }

  function renderAll(force) {
    if (!S.ref || S.dead || !el.head) return;
    const list = effective();
    if (S.sel == null || !list.some((m) => m.no === S.sel)) {
      const cur = pickCurrent(filtered(list).length ? filtered(list) : list);
      S.sel = cur ? cur.no : null;
    }
    renderHead();
    renderFailures();
    renderFilter();
    const fpList = JSON.stringify([S.sel, S.filter, list.map((m) => [m.no, m.status, m.score_a, m.score_b, m.forfeit, m.pending, sideName(m, 'a'), sideName(m, 'b'), m.games || null])]);
    if (force || fpList !== S.fp.list) { S.fp.list = fpList; renderList(list); }
    const m = list.find((x) => x.no === S.sel) || null;
    const fpDet = JSON.stringify([S.sel, m, m && sideName(m, 'a'), m && sideName(m, 'b'), S.busy, !!S.ref.chief, S.filter, m && S.gameSel.get(m.no)]);
    if (force || fpDet !== S.fp.detail) { S.fp.detail = fpDet; renderDetail(m, list); }
  }

  function renderHead() {
    if (!el.head) return;
    empty(el.head);
    const r = S.ref || {};
    const chief = !!r.chief;
    const pending = S.q.length;
    const offline = S.netError || (typeof navigator !== 'undefined' && navigator.onLine === false);
    add(el.head,
      h('div', { class: 'r-head-row' },
        h('div', { class: 'r-head-title' },
          h('p', { class: 'r-kicker' }, 'Шүүгчийн хуудас · CS2 2026'),
          h('h1', { class: 'r-title' }, r.label || (chief ? 'Ерөнхий шүүгч' : 'Шүүгч'))),
        S.ref ? h('span', { class: `chip ${chief ? 'gold' : 'r-st-chip'}` }, chief ? 'Ерөнхий шүүгч · бүх станц' : stationLabel(r.station)) : null),
      h('div', { class: 'r-head-row r-head-status' },
        h('span', { class: `chip ${offline ? 'err' : 'ok'}` }, offline ? 'Интернэтгүй' : 'Холбогдсон'),
        S.fromCache ? h('span', { class: 'small muted' }, 'Хадгалсан мэдээлэл') : null,
        pending ? h('span', { class: 'r-pending', role: 'status' }, `Илгээгдээгүй: ${pending}`) : null,
        h('span', { class: 'spacer' }),
        pending ? h('button', { type: 'button', class: 'btn secondary r-mini', disabled: S.flushing, onclick: () => flush(true) }, S.flushing ? 'Илгээж байна…' : 'Одоо илгээх') : null,
        h('button', { type: 'button', class: 'btn secondary r-mini', onclick: () => load(false, true) }, 'Шинэчлэх')),
      S.qVolatile ? h('p', { class: 'small r-volatile' }, 'Төхөөрөмжид хадгалж чадсангүй. Илгээгдэх хүртэл хуудсыг хаахгүй байна уу.') : null);
  }

  function renderFailures() {
    empty(el.fail);
    el.fail.hidden = !S.failures.length;
    if (!S.failures.length) return;
    add(el.fail,
      h('strong', {}, 'Дараах илгээлт амжилтгүй боллоо:'),
      h('ul', {}, S.failures.map((f) => h('li', {}, `№${f.no} (${f.action === 'live' ? 'эхэлсэн' : f.action === 'final' ? 'эцсийн' : f.action === 'games' ? 'газрын оноо' : 'оноо'}): ${f.text}`))),
      h('p', { class: 'small' }, 'Оноог шалгаад дахин илгээнэ үү. Шаардлагатай бол ерөнхий шүүгчид хэлнэ үү.'),
      h('button', { type: 'button', class: 'btn secondary', onclick: () => { S.failures = []; renderFailures(); } }, 'Ойлголоо'));
  }

  function renderFilter() {
    empty(el.filter);
    const chief = !!(S.ref && S.ref.chief);
    el.filter.hidden = !chief;
    if (!chief) return;
    const opt = (val, text) => h('button', {
      type: 'button', class: `r-filter-btn${S.filter === val ? ' on' : ''}`, 'aria-pressed': S.filter === val ? 'true' : 'false',
      onclick: () => {
        S.filter = val;
        const shown = filtered(effective());
        if (!shown.some((m) => m.no === S.sel)) { const cur = pickCurrent(shown); if (cur) S.sel = cur.no; }
        renderAll(true);
      },
    }, text);
    el.filter.append(opt('all', 'Бүгд'), opt('A', 'А станц'), opt('B', 'Б станц'));
  }

  function statusChip(m) {
    const key = statusKey(m);
    if (m.pending) {
      const what = key === 'live' ? 'Эхэлсэн' : key === 'final' ? 'Эцсийн дүн' : 'Оноо';
      return h('span', { class: 'chip r-st r-st-pending' }, `${what} · дараалалд`);
    }
    return h('span', { class: `chip r-st r-st-${key}` }, STATUS_TEXT[key]);
  }
  function stageChip(m) {
    return m.stage === 'group' ? h('span', { class: `chip grp-${m.grp}` }, stageLabel(m)) : h('span', { class: 'chip gold' }, stageLabel(m));
  }

  function renderList(list) {
    empty(el.list);
    const shown = sortMatches(filtered(list));
    el.list.append(h('h2', { class: 'r-list-h' }, S.ref.chief ? 'Бүх тоглолт' : 'Станцын тоглолтууд'));
    let day = null;
    let ul = null;
    for (const m of shown) {
      const d = fmtDate(m.start);
      if (d !== day) { day = d; el.list.append(h('h3', { class: 'r-day' }, d)); ul = h('ul', { class: 'r-list' }); el.list.append(ul); }
      const sel = m.no === S.sel;
      ul.append(h('li', {}, h('button', {
        type: 'button', class: `r-item st-${statusKey(m)}${sel ? ' sel' : ''}`, 'aria-current': sel ? 'true' : null,
        onclick: () => select(m.no, true),
      },
      h('span', { class: 'r-item-time' }, fmtTime(m.start), h('small', {}, `№${m.no}`)),
      h('span', { class: 'r-item-main' },
        h('span', { class: 'r-item-teams' }, `${sideName(m, 'a')} – ${sideName(m, 'b')}`),
        h('span', { class: 'r-item-sub' }, stageLabel(m) + (S.ref.chief ? ` · ${stationLabel(m.station)}` : ''))),
      h('span', { class: 'r-item-state' }, isDone(m) ? h('b', {}, scoreText(m)) : liveSeriesText(m) ? h('b', {}, liveSeriesText(m)) : null, statusChip(m)))));
    }
    if (!shown.length) el.list.append(h('p', { class: 'muted' }, 'Тоглолт алга.'));
  }

  function select(no, scroll) {
    S.sel = no;
    renderAll(true);
    if (scroll && el.detail) { try { el.detail.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* ignore */ } }
  }

  function quickTarget(m, e) { return KO.has(m.stage) && e.ot ? 16 : 13; }
  function syncOt(m, e) { if (KO.has(m.stage) && Math.max(e.a || 0, e.b || 0) >= 16) e.ot = true; }
  function otMark(m, e) { return KO.has(m.stage) && !e.forfeit && Math.max(e.a || 0, e.b || 0) >= 16 ? ' (OT)' : ''; }

  /* ---------- Bo3 цуврал ---------- */
  function series(m) {
    try { return seriesState(m, mapPool(store.get())); } catch (x) {
      return { bo: 3, games: [], wonA: 0, wonB: 0, decided: false, winner: null, maps: [], current: 0, currentMap: null, valid: false };
    }
  }
  /** Жагсаалтад: явагдаж буй Bo3-ийн газрын тоо («1 : 0»); бусад үед ''. */
  function liveSeriesText(m) {
    if (!isBo3(m) || isDone(m)) return '';
    const s = series(m);
    return s.games.length ? `${s.wonA} : ${s.wonB}` : '';
  }
  function gamesToast(item) {
    if (item.drop) return `${item.game}-р газрын оноо устгагдлаа.`;
    if (!item.games.length) return 'Газрын оноо устгагдлаа.';
    const t = checkSeries('final', item.games);
    const n = item.game || item.games.length;
    return t.decided ? `${n}-р газрын оноо илгээгдлээ. Цуврал шийдэгдлээ: ${t.wonA} : ${t.wonB}.` : `${n}-р газрын оноо илгээгдлээ.`;
  }
  /** Сонгосон газрын таб (1…3): хэрэглэгчийн сонголт хүчинтэй бол түүнийг, эс бөгөөс тоглогдож буй газар. */
  function selGame(m, s) {
    const tabs = gameTabs(s);
    const n = S.gameSel.get(m.no);
    return tabs.some((t) => t.n === n && t.enabled) ? n : defaultGame(s);
  }
  /** n-р газрын засвар (түлхүүр «no:n»; Bo1-ийн засвар m.no-оор тусдаа). */
  function gameEdit(m, n, g) {
    const key = `${m.no}:${n}`;
    const fp = JSON.stringify([m.status, g ? g.a : null, g ? g.b : null]);
    let e = S.edits.get(key);
    if (!e || (!e.touched && e.fp !== fp)) {
      const has = !!g && Number.isInteger(g.a) && Number.isInteger(g.b);
      e = { a: has ? g.a : 0, b: has ? g.b : 0, forfeit: null, ot: has && Math.max(g.a, g.b) >= 16, touched: false, fp };
      S.edits.set(key, e);
    }
    return e;
  }
  const gameMapName = (map) => (map ? mapInfo(map).name : '');
  const gameLabel = (n, map) => `${n}-р газар${map ? ` · ${gameMapName(map)}` : ''}`;

  function refreshSeriesState(m) {
    const s = series(m);
    const n = selGame(m, s);
    const e = gameEdit(m, n, s.games[n - 1]);
    const res = checkScore(m.stage, e.a, e.b, null, e.ot);
    el.hint.textContent = res.ok ? `${n}-р газар: ${sideName(m, 'a')} ${e.a} : ${e.b} ${sideName(m, 'b')}${otMark(m, e)}` : res.msg;
    el.hint.className = `r-hint ${res.ok ? 'ok' : e.touched ? 'err' : 'muted'}`;
    if (el.send) el.send.disabled = S.busy || !res.ok;
    if (el.finalBtn) el.finalBtn.disabled = S.busy || !s.decided;
    if (el.ot) el.ot.checked = !!e.ot;
    for (const k of ['a', 'b']) {
      if (el.score[k] && document.activeElement !== el.score[k]) el.score[k].value = e[k] == null ? '' : String(e[k]);
      if (el.quick[k]) { const t = quickTarget(m, e); el.quick[k].textContent = String(t); el.quick[k].setAttribute('aria-label', `${sideName(m, k)}: ${t} оноо`); }
    }
  }

  function refreshDetailState() {
    const m = currentMatch();
    if (!m || !el.hint) return;
    if (isBo3(m)) { refreshSeriesState(m); return; }
    const e = editFor(m);
    const res = checkScore(m.stage, e.a, e.b, e.forfeit, e.ot);
    el.hint.textContent = res.ok ? `${sideName(m, 'a')} ${e.a} : ${e.b} ${sideName(m, 'b')}${e.forfeit ? ' (техникийн)' : otMark(m, e)}` : res.msg;
    el.hint.className = `r-hint ${res.ok ? 'ok' : e.touched ? 'err' : 'muted'}`;
    if (el.send) el.send.disabled = S.busy || !res.ok;
    if (el.finalBtn) el.finalBtn.disabled = S.busy || !res.ok;
    if (el.ot) el.ot.checked = !!e.ot;
    for (const k of ['a', 'b']) {
      if (el.score[k] && document.activeElement !== el.score[k]) el.score[k].value = e[k] == null ? '' : String(e[k]);
      if (el.quick[k]) { const t = quickTarget(m, e); el.quick[k].textContent = String(t); el.quick[k].setAttribute('aria-label', `${sideName(m, k)}: ${t} оноо`); }
    }
  }

  function updateLateNote() {
    if (!el.late) return;
    const m = currentMatch();
    const start = m ? Date.parse(m.start) : NaN;
    const late = m && statusKey(m) === 'scheduled' && !Number.isNaN(start) ? Math.floor((Date.now() + S.offset - start) / 60000) : 0;
    el.late.hidden = !(late > 10);
    el.late.textContent = late > 10 ? `Эхлэх цагаас ${late} минут өнгөрсөн. 10 минутаас илүү хоцорсон баг техникийн ялагдал хүлээнэ.` : '';
  }

  function sideBlock(m, e, k, info) {
    const input = h('input', {
      class: 'r-score-input', type: 'number', inputmode: 'numeric', min: '0', max: '99', step: '1',
      value: e[k] == null ? '' : String(e[k]), 'aria-label': `${info.name} — оноо`, disabled: S.busy,
      oninput: () => {
        const v = parseInt(input.value, 10);
        e[k] = Number.isFinite(v) ? Math.min(99, Math.max(0, v)) : null;
        e.touched = true; e.forfeit = null; syncOt(m, e); refreshDetailState();
      },
      onfocus: () => { try { input.select(); } catch (x) { /* ignore */ } },
    });
    const setTo = (v) => { e[k] = Math.min(99, Math.max(0, v)); input.value = String(e[k]); e.touched = true; e.forfeit = null; syncOt(m, e); refreshDetailState(); };
    const quick = h('button', { type: 'button', class: 'r-quick', disabled: S.busy, onclick: () => setTo(quickTarget(m, e)) }, String(quickTarget(m, e)));
    el.score[k] = input;
    el.quick[k] = quick;
    return h('div', { class: `r-side r-side-${k}` },
      h('div', { class: 'r-side-name' }, info.name, info.known ? null : h('span', { class: 'r-unk' }, ' · тодорхойгүй')),
      h('div', { class: 'r-stepper' },
        h('button', { type: 'button', class: 'r-step', disabled: S.busy, 'aria-label': `${info.name}: оноо хасах`, onclick: () => setTo((e[k] == null ? 0 : e[k]) - 1) }, '−'),
        input,
        h('button', { type: 'button', class: 'r-step', disabled: S.busy, 'aria-label': `${info.name}: оноо нэмэх`, onclick: () => setTo((e[k] == null ? 0 : e[k]) + 1) }, '+'),
        quick));
  }

  function renderDetail(m, list) {
    empty(el.detail);
    el.hint = null; el.send = null; el.finalBtn = null; el.ot = null; el.late = null; el.veto = null;
    el.quick = {}; el.score = {};
    if (!m) { el.detail.append(h('p', { class: 'muted' }, 'Тоглолт сонгоно уу.')); return; }
    const e = editFor(m);
    const A = side(m, 'a');
    const B = side(m, 'b');
    const ko = KO.has(m.stage);
    const key = statusKey(m);
    const shown = sortMatches(filtered(list));
    const idx = shown.findIndex((x) => x.no === m.no);
    const prev = idx > 0 ? shown[idx - 1] : null;
    const next = idx >= 0 && idx < shown.length - 1 ? shown[idx + 1] : null;

    el.late = h('p', { class: 'r-late', role: 'status', hidden: true });
    add(el.detail,
      h('div', { class: 'r-dnav' },
        h('button', { type: 'button', class: 'r-navbtn', disabled: !prev, 'aria-label': 'Өмнөх тоглолт', onclick: () => prev && select(prev.no) }, '‹'),
        h('div', { class: 'r-dtitle' },
          h('h2', { id: 'r-detail-h' }, `№${m.no} · ${fmtTime(m.start)}`),
          h('div', { class: 'r-dsub' }, stageChip(m), ` ${stationLabel(m.station)} · ${fmtDate(m.start)}`)),
        h('button', { type: 'button', class: 'r-navbtn', disabled: !next, 'aria-label': 'Дараагийн тоглолт', onclick: () => next && select(next.no) }, '›')),
      h('div', { class: 'r-dstatus' }, statusChip(m), m.pending ? h('span', { class: 'small' }, ' Холболт сэргэхэд автоматаар илгээнэ.') : null),
      el.late);
    updateLateNote();

    if (key === 'final') {
      add(el.detail,
        h('div', { class: 'r-final' },
          h('div', { class: 'r-final-teams' }, h('span', {}, A.name), h('b', { class: 'r-final-score' }, scoreText(m) || '—'), h('span', {}, B.name)),
          isBo3(m) ? seriesMapLines(m) : m.map ? h('p', { class: 'r-final-map' }, `Газрын зураг: ${mapInfo(m.map).name}`) : null,
          h('p', { class: 'small muted' }, 'Дүн баталгаажсан. Өөрчлөх бол зохион байгуулагчид хандана уу.')),
        next ? h('button', { type: 'button', class: 'btn secondary block r-big', onclick: () => select(next.no) }, 'Дараагийн тоглолт →') : null);
      return;
    }

    if (!A.known || !B.known) {
      el.detail.append(h('p', { class: 'card warn r-unknown' }, 'Багууд хараахан тодорхойгүй. Ерөнхий шүүгчээс тодруулна уу.'));
    }
    el.veto = h('section', { class: 'r-veto', 'aria-labelledby': 'r-veto-h' });
    fillVeto(el.veto, m);
    el.detail.append(el.veto);
    if (key === 'scheduled') {
      el.detail.append(h('button', { type: 'button', class: 'btn block r-big r-live', disabled: S.busy, onclick: () => send({ no: m.no, action: 'live', a: null, b: null, forfeit: null, ta: null, tb: null }) }, '▶ Эхэлсэн'));
    }
    if (isBo3(m)) { renderSeries(m, key, A, B, next); return; }
    const sides = h('div', { class: 'r-sides' }, sideBlock(m, e, 'a', A), h('div', { class: 'r-vs', 'aria-hidden': 'true' }, ':'), sideBlock(m, e, 'b', B));
    el.detail.append(sides);
    if (ko) {
      el.ot = h('input', {
        type: 'checkbox', id: 'r-ot', checked: !!e.ot, disabled: S.busy,
        onchange: () => {
          e.ot = el.ot.checked;
          e.touched = true;
          if (!e.ot && Math.max(e.a || 0, e.b || 0) >= 16) { e.ot = true; toast('Оноо 16 ба түүнээс дээш бол нэмэлт цаг болсон гэсэн үг.', 'info'); }
          refreshDetailState();
        },
      });
      el.detail.append(h('label', { class: 'r-ot', for: 'r-ot' }, el.ot, h('span', {}, 'Нэмэлт цаг (OT) болсон')));
    }
    el.hint = h('p', { class: 'r-hint', 'aria-live': 'polite' });
    el.detail.append(el.hint);
    el.send = h('button', { type: 'button', class: 'btn gold block r-big r-send', onclick: () => confirmReport(m, 'report') }, key === 'reported' ? 'Засварыг илгээх' : 'Оноо илгээх');
    const actions = h('div', { class: 'r-actions' }, el.send);
    if (S.ref.chief) {
      el.finalBtn = h('button', { type: 'button', class: 'btn block r-big', onclick: () => confirmReport(m, 'final') }, 'Эцэслэн батлах');
      actions.append(el.finalBtn);
    }
    actions.append(h('button', { type: 'button', class: 'btn secondary block r-ff-btn', disabled: S.busy, onclick: () => pickForfeit(m) }, 'Техникийн ялагдал'));
    if (key === 'reported' && next) actions.append(h('button', { type: 'button', class: 'btn secondary block', onclick: () => select(next.no) }, 'Дараагийн тоглолт →'));
    el.detail.append(actions);
    refreshDetailState();
  }

  /** Bo3: цувралын толгой (газрын тоо, газар бүрийн оноо), газрын табууд, сонгосон газрын оноо, илгээх / устгах / батлах. */
  function renderSeries(m, key, A, B, next) {
    const s = series(m);
    const n = selGame(m, s);
    const tabs = gameTabs(s);
    const g = s.games[n - 1] || null;
    const e = gameEdit(m, n, g);
    const tab = tabs.find((t) => t.n === n) || { n, map: null };
    add(el.detail,
      h('div', { class: 'r-series', role: 'group', 'aria-label': 'Bo3 цуврал' },
        h('div', { class: 'r-series-top' },
          h('span', { class: 'chip gold' }, 'Bo3'),
          h('span', { class: 'r-series-teams' }, h('span', {}, A.name), h('b', { class: 'r-series-score' }, `${s.wonA} : ${s.wonB}`), h('span', {}, B.name))),
        seriesMapLines(m, s),
        h('p', { class: 'small muted r-series-rule' }, s.decided ? 'Цуврал шийдэгдсэн.' : '3 газрын зургаас 2-т түрүүлж хожсон баг ялна. Газар бүр MR12 + нэмэлт цаг (MR3).')),
      h('div', { class: 'r-games', role: 'tablist', 'aria-label': 'Газрууд' }, tabs.map((t) => h('button', {
        type: 'button', role: 'tab', class: `r-game-tab${t.n === n ? ' on' : ''}${t.played ? ' played' : ''}`,
        'aria-selected': t.n === n ? 'true' : 'false', disabled: !t.enabled || S.busy,
        onclick: () => { S.gameSel.set(m.no, t.n); renderAll(true); },
      }, h('b', {}, `${t.n}-р газар`), h('small', {}, t.map ? gameMapName(t.map) : '—'), t.played ? h('small', { class: 'r-game-sc' }, `${t.a} : ${t.b}`) : null))));
    if (m.forfeit === 'a' || m.forfeit === 'b') {
      el.detail.append(h('p', { class: 'card warn r-unknown' }, `Техникийн ялагдал: ${sideName(m, m.forfeit)}. Цуврал ${s.wonA} : ${s.wonB}.`));
    }
    const sides = h('div', { class: 'r-sides' }, sideBlock(m, e, 'a', A), h('div', { class: 'r-vs', 'aria-hidden': 'true' }, ':'), sideBlock(m, e, 'b', B));
    el.detail.append(h('h3', { class: 'r-game-h' }, `${gameLabel(n, tab.map)} — оноо`), sides);
    el.ot = h('input', {
      type: 'checkbox', id: 'r-ot', checked: !!e.ot, disabled: S.busy,
      onchange: () => {
        e.ot = el.ot.checked;
        e.touched = true;
        if (!e.ot && Math.max(e.a || 0, e.b || 0) >= 16) { e.ot = true; toast('Оноо 16 ба түүнээс дээш бол нэмэлт цаг болсон гэсэн үг.', 'info'); }
        refreshDetailState();
      },
    });
    el.detail.append(h('label', { class: 'r-ot', for: 'r-ot' }, el.ot, h('span', {}, 'Нэмэлт цаг (OT) болсон')));
    el.hint = h('p', { class: 'r-hint', 'aria-live': 'polite' });
    el.detail.append(el.hint);
    el.send = h('button', { type: 'button', class: 'btn gold block r-big r-send', onclick: () => confirmGame(m, n) },
      g ? `${n}-р газрын засварыг илгээх` : `${n}-р газрын оноо илгээх`);
    const actions = h('div', { class: 'r-actions' }, el.send);
    if (S.ref.chief) {
      el.finalBtn = h('button', { type: 'button', class: 'btn block r-big', onclick: () => confirmSeriesFinal(m) }, 'Эцэслэн батлах');
      actions.append(el.finalBtn);
    }
    if (g && n === s.games.length) {
      actions.append(h('button', { type: 'button', class: 'btn secondary block r-drop', disabled: S.busy, onclick: () => confirmDropLast(m) }, `${n}-р газрын оноог устгах`));
    }
    actions.append(h('button', { type: 'button', class: 'btn secondary block r-ff-btn', disabled: S.busy, onclick: () => pickForfeit(m) }, 'Техникийн ялагдал'));
    if (key === 'reported' && next) actions.append(h('button', { type: 'button', class: 'btn secondary block', onclick: () => select(next.no) }, 'Дараагийн тоглолт →'));
    el.detail.append(actions);
    refreshDetailState();
  }

  /** Bo3-ийн газрууд: «Inferno 13 : 9», «Nuke 9 : 13», «Mirage — одоо / тоглогдоогүй». Газрын нэргүй бол «N-р газар». */
  function seriesMapLines(m, s0) {
    const s = s0 || series(m);
    const ol = h('ol', { class: 'r-series-maps' });
    for (let i = 0; i < 3; i++) {
      const g = s.games[i] || null;
      const map = (g && g.map) || (s.maps && s.maps[i]) || null;
      if (!g && !map) continue;
      ol.append(h('li', { class: g ? `won-${g.winner}` : 'todo' },
        h('span', { class: 'r-sm-map' }, map ? gameMapName(map) : `${i + 1}-р газар`),
        h('b', { class: 'r-sm-sc' }, g ? `${g.a} : ${g.b}${g.ot ? ' (OT)' : ''}` : s.decided ? 'тоглогдоогүй' : i === s.current ? 'одоо' : '—')));
    }
    return ol.childNodes.length ? ol : null;
  }

  function confirmGame(m, n) {
    const s = series(m);
    const e = gameEdit(m, n, s.games[n - 1]);
    const res = checkScore(m.stage, e.a, e.b, null, e.ot);
    if (!res.ok) { toast(res.msg, 'err', 5000); return; }
    const built = setGame(s.games, n, e.a, e.b);
    if (!built) { toast('Газрыг дарааллаар нь оруулна уу.', 'err', 5000); return; }
    const chk = checkSeries(m.stage, built.games);
    if (!chk.ok) { toast(chk.msg, 'err', 6000); return; }
    const A = side(m, 'a');
    const B = side(m, 'b');
    const map = (s.games[n - 1] && s.games[n - 1].map) || (s.maps && s.maps[n - 1]) || null;
    const tail = Math.max(e.a, e.b) >= 16 ? ' (OT)' : '';
    const next3 = !chk.decided && chk.wonA === 1 && chk.wonB === 1;
    const md = openModal({
      title: 'Газрын оноо шалгах',
      className: 'r-confirm',
      body: [
        h('p', { class: 'center r-confirm-game' }, `${stageLabel(m)} · ${gameLabel(n, map)}`),
        h('p', { class: 'r-confirm-line' }, `${A.name} ${e.a} : ${e.b} ${B.name}${tail} — Зөв үү?`),
        built.dropped ? h('p', { class: 'r-confirm-sub' }, `Цуврал ${n}-р газарт шийдэгдэх тул дараагийн газрын оноо (${built.dropped}) устна.`) : null,
        h('p', { class: 'center' }, `Цуврал: ${A.name} ${chk.wonA} : ${chk.wonB} ${B.name}${chk.decided ? ' — шийдэгдэнэ.' : next3 ? ' — 3-р газар тоглоно.' : ''}`),
        h('p', { class: 'small muted' }, `№${m.no} · ${stationLabel(m.station)}`),
      ],
      actions: [
        h('button', {
          type: 'button', class: 'btn gold block r-big', 'data-autofocus': '',
          onclick: () => { md.close(); send({ no: m.no, action: 'games', games: built.games, game: n, a: null, b: null, forfeit: null, ta: null, tb: null }); },
        }, 'Тийм, илгээх'),
        h('button', { type: 'button', class: 'btn secondary block r-big', onclick: () => md.close() }, 'Үгүй, засах'),
      ],
    });
  }

  function confirmDropLast(m) {
    const s = series(m);
    const n = s.games.length;
    if (!n) return;
    const g = s.games[n - 1];
    const md = openModal({
      title: 'Газрын оноог устгах',
      className: 'r-confirm',
      body: [h('p', { class: 'r-confirm-line' }, `${gameLabel(n, g.map)}: ${g.a} : ${g.b}`), h('p', { class: 'center' }, 'Энэ газрын оноог устгах уу?'), vsLine(m)],
      actions: [
        h('button', {
          type: 'button', class: 'btn danger block r-big',
          onclick: () => {
            md.close();
            send({ no: m.no, action: 'games', games: s.games.slice(0, n - 1).map((x) => ({ a: x.a, b: x.b })), game: n, drop: true, a: null, b: null, forfeit: null, ta: null, tb: null });
          },
        }, 'Тийм, устгах'),
        h('button', { type: 'button', class: 'btn secondary block r-big', 'data-autofocus': '', onclick: () => md.close() }, 'Болих'),
      ],
    });
  }

  /** Ерөнхий шүүгч: шийдэгдсэн цувралыг батлана (cs2_ref_report 'final', оноогүй — сервер хадгалсан цувралыг батална). */
  function confirmSeriesFinal(m) {
    const s = series(m);
    if (!s.decided) { toast('Цуврал шийдэгдээгүй байна: 3 газрын зургаас 2-т түрүүлж хожсон баг ялна.', 'err', 5000); return; }
    const A = side(m, 'a');
    const B = side(m, 'b');
    const md = openModal({
      title: 'Эцсийн дүн',
      className: 'r-confirm',
      body: [
        h('p', { class: 'r-confirm-line' }, `${A.name} ${s.wonA} : ${s.wonB} ${B.name}${m.forfeit ? ' (техникийн)' : ''} — Эцэслэн батлах уу?`),
        s.games.length ? h('p', { class: 'center' }, gamesText(s.games)) : null,
        h('p', { class: 'small muted' }, `№${m.no} · ${stageLabel(m)} · ${stationLabel(m.station)}`),
        h('p', { class: 'small' }, 'Батлагдсан дүнг зөвхөн зохион байгуулагч өөрчилнө.'),
      ],
      actions: [
        h('button', {
          type: 'button', class: 'btn gold block r-big', 'data-autofocus': '',
          onclick: () => { md.close(); send({ no: m.no, action: 'final', a: null, b: null, forfeit: null, ta: A.id, tb: B.id }); },
        }, 'Тийм, батлах'),
        h('button', { type: 'button', class: 'btn secondary block r-big', onclick: () => md.close() }, 'Үгүй, засах'),
      ],
    });
  }

  function pickForfeit(m) {
    const A = side(m, 'a');
    const B = side(m, 'b');
    const md = openModal({
      title: 'Техникийн ялагдал',
      body: [
        h('p', {}, 'Аль баг техникийн ялагдал хүлээх вэ?'),
        h('p', { class: 'small muted' }, isBo3(m)
          ? '10 минутаас илүү хоцорсон, ирээгүй эсвэл тоглох боломжгүй баг. Нөгөө баг цувралыг 2 : 0-ээр хожно.'
          : '10 минутаас илүү хоцорсон, ирээгүй эсвэл тоглох боломжгүй баг. Нөгөө баг 13 : 0 оноогоор ялна.'),
        h('div', { class: 'r-ff-choices' },
          h('button', { type: 'button', class: 'btn danger block r-big', onclick: () => { md.close(); confirmReport(m, 'report', 'a'); } }, A.name),
          h('button', { type: 'button', class: 'btn danger block r-big', onclick: () => { md.close(); confirmReport(m, 'report', 'b'); } }, B.name)),
      ],
      actions: [h('button', { type: 'button', class: 'btn secondary', 'data-autofocus': '', onclick: () => md.close() }, 'Болих')],
    });
  }

  function confirmReport(m, action, ff) {
    if (isBo3(m)) {   // Bo3: зөвхөн цувралын техникийн ялагдал (газрын оноо — confirmGame, батлах — confirmSeriesFinal)
      if (!ff) { if (action === 'final') confirmSeriesFinal(m); return; }
      const A3 = side(m, 'a');
      const B3 = side(m, 'b');
      const md3 = openModal({
        title: 'Оноо шалгах',
        className: 'r-confirm',
        body: [
          h('p', { class: 'r-confirm-line' }, `${A3.name} ${ff === 'a' ? 0 : 2} : ${ff === 'a' ? 2 : 0} ${B3.name} (техникийн) — Зөв үү?`),
          h('p', { class: 'r-confirm-sub' }, `${ff === 'a' ? A3.name : B3.name} техникийн ялагдал хүлээнэ.`),
          h('p', { class: 'small muted' }, `№${m.no} · ${stageLabel(m)} · ${stationLabel(m.station)}`),
        ],
        actions: [
          h('button', {
            type: 'button', class: 'btn gold block r-big', 'data-autofocus': '',
            onclick: () => { md3.close(); send({ no: m.no, action: 'report', a: null, b: null, forfeit: ff, ta: A3.id, tb: B3.id }); },
          }, 'Тийм, илгээх'),
          h('button', { type: 'button', class: 'btn secondary block r-big', onclick: () => md3.close() }, 'Үгүй, засах'),
        ],
      });
      return;
    }
    const e = editFor(m);
    let a = e.a;
    let b = e.b;
    let forfeit = e.forfeit || null;
    if (ff) { forfeit = ff; a = ff === 'a' ? 0 : 13; b = ff === 'a' ? 13 : 0; }
    const res = checkScore(m.stage, a, b, forfeit, ff ? false : e.ot);
    if (!res.ok) { toast(res.msg, 'err', 5000); return; }
    const A = side(m, 'a');
    const B = side(m, 'b');
    const ot = !forfeit && KO.has(m.stage) && Math.max(a, b) >= 16;
    const tail = forfeit ? ' (техникийн)' : ot ? ' (OT)' : '';
    const question = action === 'final' ? 'Эцэслэн батлах уу?' : 'Зөв үү?';
    const md = openModal({
      title: action === 'final' ? 'Эцсийн дүн' : 'Оноо шалгах',
      className: 'r-confirm',
      body: [
        h('p', { class: 'r-confirm-line' }, `${A.name} ${a} : ${b} ${B.name}${tail} — ${question}`),
        forfeit ? h('p', { class: 'r-confirm-sub' }, `${forfeit === 'a' ? A.name : B.name} техникийн ялагдал хүлээнэ.`) : null,
        h('p', { class: 'small muted' }, `№${m.no} · ${stageLabel(m)} · ${stationLabel(m.station)}`),
        action === 'final' ? h('p', { class: 'small' }, 'Батлагдсан дүнг зөвхөн зохион байгуулагч өөрчилнө.') : null,
      ],
      actions: [
        h('button', {
          type: 'button', class: 'btn gold block r-big', 'data-autofocus': '',
          onclick: () => { md.close(); send({ no: m.no, action, a, b, forfeit, ta: A.id, tb: B.id }); },
        }, action === 'final' ? 'Тийм, батлах' : 'Тийм, илгээх'),
        h('button', { type: 'button', class: 'btn secondary block r-big', onclick: () => md.close() }, 'Үгүй, засах'),
      ],
    });
  }

  async function send(entry) {
    if (!S.token) return;
    const item = { ...entry, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, at: Date.now() };
    if (S.q.length || S.flushing) {
      queueAdd(item);
      toast('Дараалалд нэмлээ.', 'warn');
      renderAll(true);
      flush();
      return;
    }
    S.busy = true;
    renderAll();
    let r = null;
    let err = null;
    try { r = await callEntry(item); } catch (x) { err = x; }
    S.busy = false;
    if (S.dead) return;
    if (err) {
      if (isTransient(err)) {
        queueAdd(item);
        S.netError = true;
        toast('Интернэт алга. Холболт сэргэхэд автоматаар илгээнэ.', 'warn', 5000);
      } else toast(`Илгээж чадсангүй (${err.message}).`, 'err', 6000);
      renderAll(true);
      return;
    }
    if (r && r.ok) {
      S.netError = false;
      const ed = S.edits.get(item.no);
      if (ed) ed.touched = false;
      if (item.action === 'games') {
        for (let n = 1; n <= 3; n++) { const g = S.edits.get(`${item.no}:${n}`); if (g) g.touched = false; }
        S.gameSel.delete(item.no);   // дараагийн (тоглогдож буй) газрын таб руу
      }
      toast(item.action === 'live' ? 'Тоглолт эхэллээ.' : item.action === 'final' ? 'Эцэслэн баталгаажлаа.' : item.action === 'games' ? gamesToast(item)
        : 'Оноо илгээгдлээ. Баярлалаа!', 'ok');
      await load(true);
      renderAll(true);
      return;
    }
    const code = r && r.error;
    if (code === 'bad_token' || code === 'expired') { invalidate(code); return; }
    toast(`№${item.no}: ${reportErrorText(r)}`, 'err', 6000);
    renderAll(true);
  }

  /* ---------- map veto (зөвхөн онлайн, нэг удаад нэг хүсэлт; дараалалд орохгүй) ---------- */
  function refreshVeto() {
    if (!el.veto || !el.detail || !el.detail.contains(el.veto)) return;
    const m = currentMatch();
    if (m) fillVeto(el.veto, m);
  }

  function fillVeto(box, m) {
    const act = document.activeElement;
    const focusKey = act && box.contains(act) && act.dataset ? act.dataset.vk || null : null;
    empty(box);
    const pool = mapPool(store.get());
    const v = vetoState(m, pool);
    if (S.vetoView && (S.vetoView.no !== m.no || S.vetoView.status !== m.status)) S.vetoView = null;   // өөр тоглолт / төлөв өөрчлөгдсөн → анхдагч
    const collapsed = vetoCollapsed(v, m, S.vetoView);
    box.classList.toggle('done', v.done);
    box.classList.toggle('compact', collapsed);
    if (collapsed) vetoSummary(box, m, v); else vetoPanel(box, m, v, pool);
    if (focusKey) {
      const f = Array.from(box.querySelectorAll('[data-vk]')).find((b) => b.dataset.vk === focusKey);
      if (f && !f.disabled) { try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    }
  }

  /** Дууссан хасалт, товч: газрын зураг, команд + «Хуулах», «Хасалтыг харах» — тоглолтын үеэр онооны хэсэг дэлгэцэнд үлдэнэ. */
  function vetoSummary(box, m, v) {
    if (v.bo === 3) {
      add(box,
        h('h3', { class: 'r-veto-sum-h', id: 'r-veto-h' }, 'Газрууд: ', h('b', {}, v.maps.map((k) => mapInfo(k).name.toUpperCase()).join(' → '))),
        serverRows(m, v),
        h('div', { class: 'r-veto-cmd' }, h('button', {
          type: 'button', class: 'r-veto-more', 'data-vk': 'toggle', 'aria-expanded': 'false', onclick: () => setVetoOpen(m.no, true),
        }, 'Хасалт, сонголтыг харах', caret('▾'))));
      return;
    }
    add(box,
      h('h3', { class: 'r-veto-sum-h', id: 'r-veto-h' }, 'Газрын зураг: ', h('b', {}, mapInfo(v.map).name.toUpperCase())),
      serverRows(m, v),
      h('div', { class: 'r-veto-cmd' }, h('button', {
        type: 'button', class: 'r-veto-more', 'data-vk': 'toggle', 'aria-expanded': 'false', onclick: () => setVetoOpen(m.no, true),
      }, 'Хасалтыг харах', caret('▾'))),
      m.status === 'scheduled' ? h('p', { class: 'r-veto-knife sm' }, 'Талыг хутганы раундаар сонгоно.') : null);
  }

  /**
   * Серверийн мөрүүд зөвхөн тоглолт эхлэхээс өмнө (admin-тай ижил дараалал): MatchZy match JSON-ий maplist, эсвэл JSON
   * ачаалсан бол консолын changelevel. Тоглолт эхэлсний дараа харуулахгүй — тоглолтын дундуур газрын зураг солигдохгүй.
   */
  function serverRows(m, v) {
    if (v.bo === 3) return bo3Rows(m, v);
    if (m.status !== 'scheduled') return null;
    return [
      h('p', { class: 'small muted r-veto-cmd-l' }, 'Техникийн ахлагчид — match JSON-ий мөр:'),
      cmdRow(maplistCmd(v.map)),
      h('p', { class: 'small muted r-veto-cmd-l' }, 'JSON ачаалсан бол консолд (зөвхөн LIVE-аас өмнө):'),
      cmdRow(serverCmd(v.map)),
    ];
  }

  /* Bo3 MatchZy: талын сонголт энэ төхөөрөмжид (localStorage, токены хэшээр), DB-д хадгалахгүй; хасалт өөрчлөгдвөл хоосорно */
  function sidesStore() {
    if (S.sides) return S.sides;
    let o = null;
    try { o = JSON.parse(sGet('local', SIDES_PREFIX + S.tag) || 'null'); } catch (e) { o = null; }
    S.sides = o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    return S.sides;
  }
  const sidesFp = (v) => `${v.maps.join(',')}|${v.first}`;
  function sideChoices(m, v) {
    const rec = sidesStore()[m.no];
    return rec && rec.fp === sidesFp(v) ? { 1: rec[1] || null, 2: rec[2] || null } : { 1: null, 2: null };
  }
  function setSideChoice(m, v, game, choice) {
    const st = sidesStore();
    const cur = st[m.no] && st[m.no].fp === sidesFp(v) ? st[m.no] : { fp: sidesFp(v) };
    cur[game] = cur[game] === choice ? null : choice;   // ижил товчийг дахин дарвал болино
    st[m.no] = cur;
    sSet('local', SIDES_PREFIX + S.tag, JSON.stringify(st));
    refreshVeto();
  }

  /**
   * Bo3-ийн серверийн мөрүүд. Тоглолт эхлэхээс өмнө: 1, 2-р газрын талын сонголт + MatchZy JSON (num_maps, maplist,
   * map_sides, clinch_series) — хоёр тал сонгогдох хүртэл «Хуулах» идэвхгүй. Явагдаж байхад: MatchZy цуврал ажиллахгүй
   * үеийн нөөц — одоогийн газрын changelevel + тухайн газрын тал.
   */
  function bo3Rows(m, v) {
    if (!v.done) return null;
    if (m.status === 'scheduled') {
      const ch = sideChoices(m, v);
      const rows = [h('p', { class: 'small muted r-veto-cmd-l' }, 'Тал сонгох (MatchZy JSON-д; энэ утсанд л хадгална):')];
      for (const game of [1, 2]) {
        const who = sideChooser(v.first, game);
        rows.push(h('div', { class: 'r-side-pick', role: 'group', 'aria-label': `${game}-р газрын тал` },
          h('span', { class: 'r-side-pick-l' }, `${game}. ${gameMapName(v.maps[game - 1])} — `, h('b', {}, sideName(m, who)), ' сонгоно:'),
          h('span', { class: 'r-side-btns' }, ['ct', 't'].map((c) => h('button', {
            type: 'button', class: `r-side-btn ${c}${ch[game] === c ? ' on' : ''}`, 'data-vk': `side${game}${c}`,
            'aria-pressed': ch[game] === c ? 'true' : 'false', 'aria-label': `${game}-р газар: ${sideName(m, who)} ${c.toUpperCase()}`,
            onclick: () => setSideChoice(m, v, game, c),
          }, c.toUpperCase())))));
      }
      rows.push(h('p', { class: 'r-side-pick r-side-knife' }, `3. ${gameMapName(v.maps[2])} — хутганы раунд`));
      const lines = bo3JsonLines(v.maps, v.first, ch);
      const ready = !!(ch[1] && ch[2]);
      rows.push(h('p', { class: 'small muted r-veto-cmd-l' }, 'Техникийн ахлагчид — бэлдсэн match JSON-ий эдгээр мөрийг солино (давхардуулахгүй):'));
      rows.push(h('div', { class: 'r-veto-cmd' },
        h('code', { class: 'r-veto-code r-json' }, lines.join('\n')),
        h('button', {
          type: 'button', class: 'btn secondary r-veto-copy', disabled: !ready, 'aria-label': 'Хуулах: MatchZy JSON-ий мөрүүд',
          onclick: () => copyText(lines.join('\n')),
        }, 'Хуулах')));
      if (!ready) rows.push(h('p', { class: 'small r-side-wait' }, 'Эхлээд 1, 2-р газрын талыг сонгоно уу. Сонгоогүй талыг систем таахгүй.'));
      return rows;
    }
    const s = series(m);
    if (m.status !== 'live' || s.decided || !s.currentMap) return null;
    const n = s.current + 1;
    const ch = sideChoices(m, v);
    const who = sideChooser(v.first, n);
    return [
      h('p', { class: 'small muted r-veto-cmd-l' }, `MatchZy цуврал ажиллахгүй бол — ${gameLabel(n, s.currentMap)}, зөвхөн газрын хооронд консолд:`),
      cmdRow(serverCmd(s.currentMap)),
      h('p', { class: 'r-side-pick r-side-now' }, n === 3 ? 'Тал: хутганы раунд.'
        : ch[n] ? `Тал: ${sideName(m, who)} ${ch[n].toUpperCase()} талаас эхэлнэ.` : `Тал: ${sideName(m, who)} сонгоно.`),
    ];
  }

  const caret = (c) => h('span', { class: 'r-veto-caret', 'aria-hidden': 'true' }, c);

  function cmdRow(cmd, extra) {
    return h('div', { class: 'r-veto-cmd' },
      h('code', { class: 'r-veto-code' }, cmd),
      h('button', { type: 'button', class: 'btn secondary r-veto-copy', 'aria-label': `Хуулах: ${cmd}`, onclick: () => copyText(cmd) }, 'Хуулах'),
      extra);
  }

  /** «Хасалтыг харах» / «Хураах»: энэ тоглолтын одоогийн төлөвт хадгална (төлөв өөрчлөгдвөл анхдагч руу буцна). */
  function setVetoOpen(no, open) {
    const cur = currentMatch();
    S.vetoView = { no, status: cur && cur.no === no ? cur.status : null, open };
    refreshVeto();
  }

  /** Бүтэн самбар: явагдаж буй хасалт, эсвэл дэлгэсэн дууссан хасалт (хавтан, буцаах, шинээр эхлүүлэх). */
  function vetoPanel(box, m, v, pool) {
    const acc = vetoAccess(m, S.ref);
    const busy = S.vetoBusy;
    const ko = KO.has(m.stage);
    const name = (s) => sideName(m, s);
    const step = v.steps.length;
    const s0 = S.vetoSel;
    const sel = s0 && s0.no === m.no && s0.step === step && !v.done && v.remaining.includes(s0.map) ? s0.map : null;
    const pickable = acc.can && !!v.next;
    const bo3 = v.bo === 3;
    const pickStep = v.nextAct === 'pick';

    add(box, h('div', { class: 'r-veto-top' },
      h('h3', { class: 'r-veto-h', id: 'r-veto-h' }, bo3 ? 'Газрын зураг · Bo3' : 'Газрын зураг'),
      h('span', { class: 'chip r-veto-prog' }, `${bo3 ? 'Алхам' : 'Хасалт'} ${step}/${v.total}`)));
    if (S.vetoOff) box.append(h('p', { class: 'r-veto-off', role: 'alert' }, VETO_OFF_TEXT));

    if (v.done && bo3) {
      const pickers = v.steps.filter((_, i) => v.acts[i] === 'pick').map((st) => st.side);
      box.append(h('div', { class: 'r-veto-play' },
        h('p', { class: 'r-veto-play-l' }, 'Тоглох газрууд:'),
        h('ol', { class: 'r-veto-play-list' }, v.maps.map((k, i) => h('li', {},
          h('b', {}, mapInfo(k).name.toUpperCase()),
          h('small', {}, i < 2 && pickers[i] ? `${shortTeam(name(pickers[i]))} сонгосон` : 'шийдвэрлэх')))),
        serverRows(m, v)));
    } else if (v.done) {
      box.append(h('div', { class: 'r-veto-play' },
        h('p', { class: 'r-veto-play-l' }, 'Тоглох газрын зураг:'),
        h('p', { class: 'r-veto-play-map' }, mapInfo(v.map).name.toUpperCase()),
        serverRows(m, v),
        h('p', { class: 'r-veto-knife' }, 'Талыг хутганы раундаар сонгоно.')));
    } else if (v.needsFirst) {
      if (acc.can) {
        box.append(h('div', { class: 'r-veto-coin' },
          h('p', { class: 'r-veto-ask' }, 'Хэн эхэлж хасахыг зоосоор шийднэ'),
          h('button', { type: 'button', class: 'btn gold block r-big', disabled: busy, onclick: () => confirmCoin(m) }, busy ? 'Илгээж байна…' : 'Зоос шидэх'),
          h('p', { class: 'small muted r-veto-or' }, 'Зоосыг гараар шидсэн бол:'),
          h('div', { class: 'r-veto-coin-row' }, ['a', 'b'].map((s) => h('button', {
            type: 'button', class: 'btn secondary block r-big r-veto-side', disabled: busy, onclick: () => confirmFirst(m, s),
          }, `${name(s)} эхэлнэ`)))));
      } else box.append(h('p', { class: 'r-veto-ask' }, 'Зоос шидээгүй байна'));
    } else {
      box.append(h('p', { class: `r-veto-turn${pickStep ? ' pick' : ''}`, 'aria-live': 'polite' }, h('b', {}, name(v.next.side)),
        pickStep ? ` сонгоно (${v.picks.length + 1}-р газар)` : ' хасна'));
    }
    if (bo3 && !v.done) box.append(h('p', { class: 'r-veto-first' }, 'Bo3: хасах, хасах, сонгох, сонгох, хасах, хасах → үлдсэн нь 3-р газар.'));
    if (ko && v.first && !v.done) box.append(h('p', { class: 'r-veto-first' }, `Зоос${v.coin ? ' (систем)' : ''}: ${name(v.first)} эхэлж хасна`));
    if (ko && v.first && !v.started && acc.can && !acc.chief) box.append(h('p', { class: 'small muted r-veto-note' }, 'Буруу бол ерөнхий шүүгч шинээр эхлүүлнэ.'));
    if (!ko && !v.started) box.append(h('p', { class: 'r-veto-first' }, 'Эхэнд бичигдсэн баг эхэлж хасна. Ээлжлэн 3, 3 хасаад үлдсэнд тоглоно.'));

    const grid = h('div', { class: 'r-veto-grid', role: 'group', 'aria-label': 'Газрын зургууд' });
    for (const t of vetoTiles(v, pool)) {
      const on = pickable && !t.ban && !t.play && !t.pick && !t.decider;
      const isSel = t.key === sel;
      const by = t.ban ? shortTeam(name(t.ban.side)) : t.pick ? shortTeam(name(t.pick.side)) : '';
      grid.append(h('button', {
        type: 'button',
        class: `r-veto-tile${t.ban ? ' banned' : ''}${t.play ? ' play' : ''}${t.pick ? ' pick' : ''}${t.decider ? ' decider' : ''}${isSel ? ` sel${pickStep ? ' sel-pick' : ''}` : ''}`,
        'data-vk': t.key, disabled: !on || busy, 'aria-pressed': on ? String(isSel) : null,
        'aria-label': t.ban ? `${t.name}: ${by} хассан (${t.ban.order}-р хасалт)` : t.pick ? `${t.name}: ${t.pick.game}-р газар, ${by} сонгосон`
          : t.decider ? `${t.name}: 3-р газар, шийдвэрлэх` : t.play ? `${t.name}: тоглоно` : null,
        onclick: on ? () => pickMap(m.no, t.key, step) : null,
      },
      h('span', { class: 'r-veto-name' }, t.name),
      t.ban ? h('small', {}, `✕ ${by}`) : t.pick ? [h('small', {}, `${t.pick.game}-р газар`), h('small', {}, by)]
        : t.decider ? [h('small', {}, '3-р газар'), h('small', {}, 'шийдвэрлэх')] : t.play ? h('small', {}, 'ТОГЛОНО') : isSel ? h('small', {}, 'Сонгосон') : null));
    }
    box.append(grid);

    if (pickable) {
      box.append(h('button', {
        type: 'button', class: `btn ${pickStep ? 'gold' : 'danger'} block r-big r-veto-go`, disabled: busy || !sel,
        onclick: () => {
          if (!sel) return;
          vetoSend(m.no, vetoAct(v), vetoBanArgs(v, sel), (r) => {
            if (!bo3) return r.match && r.match.map ? `Тоглох газрын зураг: ${mapInfo(r.match.map).name}` : `${mapInfo(sel).name} хасагдлаа.`;
            const mm = r.match && Array.isArray(r.match.maps) ? r.match.maps : [];
            if (mm.length === 3) return `Газрууд: ${mm.map((k) => mapInfo(k).name).join(' → ')}`;
            return pickStep ? `${mapInfo(sel).name} — ${v.picks.length + 1}-р газар.` : `${mapInfo(sel).name} хасагдлаа.`;
          });
        },
      }, busy ? 'Илгээж байна…' : sel ? `${mapInfo(sel).name} ${pickStep ? 'сонгох' : 'хасах'}` : 'Газрын зураг сонгоно уу'));
    }
    if (acc.can && (v.started || (acc.chief && ko && v.first))) {
      box.append(h('div', { class: 'r-veto-tools' },
        v.started ? h('button', { type: 'button', class: 'btn secondary r-veto-undo', disabled: busy, onclick: () => confirmUndo(m) }, '↶ Буцаах') : null,
        acc.chief ? h('button', { type: 'button', class: 'btn secondary r-veto-reset', disabled: busy, onclick: () => confirmReset(m) }, 'Шинээр эхлүүлэх') : null));
    }
    if (acc.reason === 'already_reported') box.append(h('p', { class: 'small muted r-veto-note' }, 'Оноо илгээсэн тул газрын зургийг зөвхөн ерөнхий шүүгч өөрчилнө.'));
    if (acc.reason === 'games_started') box.append(h('p', { class: 'small muted r-veto-note' }, 'Газрын оноо орсон тул газрын зургийн сонголтыг өөрчлөхгүй (зөвхөн зохион байгуулагч).'));
    if (v.done) {
      box.append(h('button', {
        type: 'button', class: 'r-veto-more r-veto-less', 'data-vk': 'toggle', 'aria-expanded': 'true', onclick: () => setVetoOpen(m.no, false),
      }, 'Хураах', caret('▴')));
    }
  }

  /** 1-р товшилт сонгоно, 2-р товшилт (өөр хавтан) сонголтыг солино, ижил хавтан — болино. */
  function pickMap(no, key, step) {
    if (S.vetoBusy) return;
    const p = S.vetoSel;
    S.vetoSel = p && p.no === no && p.map === key && p.step === step ? null : { no, map: key, step };
    refreshVeto();
  }

  const chiefNote = () => (S.ref && S.ref.chief ? null : h('p', { class: 'small' }, 'Дараа нь зөвхөн ерөнхий шүүгч өөрчилнө.'));
  const vsLine = (m) => h('p', { class: 'small muted' }, `№${m.no} · ${sideName(m, 'a')} – ${sideName(m, 'b')}`);

  function confirmCoin(m) {
    const md = openModal({
      title: 'Зоос шидэх',
      className: 'r-confirm',
      body: [h('p', {}, 'Систем санамсаргүйгээр хэн эхэлж хасахыг шийднэ.'), vsLine(m), chiefNote()],
      actions: [
        h('button', {
          type: 'button', class: 'btn gold block r-big', 'data-autofocus': '',
          onclick: async () => {
            md.close();
            const r = await vetoSend(m.no, 'first', { side: 'coin', step: 0 }, null);
            const f = r && r.match && r.match.veto_first;
            if (f !== 'a' && f !== 'b') return;
            const res = openModal({
              title: 'Зоосны дүн',
              className: 'r-confirm',
              body: [h('p', { class: 'r-confirm-line' }, `${sideName(m, f)} эхэлж хасна`), vsLine(m)],
              actions: [h('button', { type: 'button', class: 'btn block r-big', 'data-autofocus': '', onclick: () => res.close() }, 'Ойлголоо')],
            });
          },
        }, 'Тийм, шидэх'),
        h('button', { type: 'button', class: 'btn secondary block r-big', onclick: () => md.close() }, 'Болих'),
      ],
    });
  }

  function confirmFirst(m, s) {
    const who = sideName(m, s);
    const md = openModal({
      title: 'Эхэлж хасах баг',
      className: 'r-confirm',
      body: [h('p', { class: 'r-confirm-line' }, `${who} эхэлж хасна — Зөв үү?`), h('p', { class: 'small muted' }, 'Зоосыг гараар шидсэн.'), vsLine(m), chiefNote()],
      actions: [
        h('button', {
          type: 'button', class: 'btn gold block r-big', 'data-autofocus': '',
          onclick: () => { md.close(); vetoSend(m.no, 'first', { side: s, step: 0 }, () => `${who} эхэлж хасна.`); },
        }, 'Тийм'),
        h('button', { type: 'button', class: 'btn secondary block r-big', onclick: () => md.close() }, 'Үгүй'),
      ],
    });
  }

  function confirmUndo(m) {
    const v = vetoState(m, mapPool(store.get()));
    const last = v.steps[v.steps.length - 1];
    if (!last) return;
    const map = mapInfo(last.map).name;
    const wasPick = v.acts[v.steps.length - 1] === 'pick';
    const md = openModal({
      title: wasPick ? 'Сонголтыг буцаах' : 'Хасалтыг буцаах',
      className: 'r-confirm',
      body: [h('p', { class: 'r-confirm-line' }, `${map} · ${sideName(m, last.side)}`), h('p', { class: 'center' }, wasPick ? 'Сүүлийн сонголтыг буцаах уу?' : 'Сүүлийн хасалтыг буцаах уу?'), vsLine(m)],
      actions: [
        h('button', {
          type: 'button', class: 'btn gold block r-big', 'data-autofocus': '',
          onclick: () => { md.close(); vetoSend(m.no, 'undo', { step: v.steps.length }, () => `${map} буцаагдлаа.`); },
        }, 'Тийм, буцаах'),
        h('button', { type: 'button', class: 'btn secondary block r-big', onclick: () => md.close() }, 'Үгүй'),
      ],
    });
  }

  function confirmReset(m) {
    const v = vetoState(m, mapPool(store.get()));
    const md = openModal({
      title: 'Шинээр эхлүүлэх',
      className: 'r-confirm',
      body: [
        h('p', { class: 'r-confirm-sub' }, isBo3(m) ? 'Бүх хасалт, сонголт устана.' : 'Бүх хасалт устана.'),
        KO.has(m.stage) ? h('p', { class: 'center' }, 'Зоосны шийдвэр мөн устана.') : null,
        vsLine(m),
      ],
      actions: [
        h('button', {
          type: 'button', class: 'btn danger block r-big',
          onclick: () => { md.close(); vetoSend(m.no, 'reset', { step: v.steps.length }, () => 'Хасалтыг шинээр эхлүүллээ.'); },
        }, 'Тийм, шинээр эхлүүлэх'),
        h('button', { type: 'button', class: 'btn secondary block r-big', 'data-autofocus': '', onclick: () => md.close() }, 'Болих'),
      ],
    });
  }

  /** cs2_ref_veto: амжилттай бол хариуны тоглолтоос хасалтын талбаруудыг шууд нэгтгэнэ; бусад үед мэдэгдэл + шинэчлэл. */
  async function vetoSend(no, action, opts, okText) {
    if (!S.token || S.vetoBusy) return null;
    S.vetoBusy = true;
    refreshVeto();
    let r = null;
    let err = null;
    try { r = await refVeto(S.token, no, action, opts); } catch (x) { err = x; }
    S.vetoBusy = false;
    if (S.dead) return null;
    if (err) {
      if (isMissingRpc(err)) { S.vetoOff = true; toast(VETO_OFF_TEXT, 'err', 8000); } else if (isTransient(err)) {
        S.netError = true;
        renderHead();
        toast('Интернэт алга. Холболтоо шалгаад дахин оролдоно уу.', 'warn', 5000);
      } else toast(`Илгээж чадсангүй (${err.message}).`, 'err', 6000);
      refreshVeto();
      return null;
    }
    if (r && r.ok) {
      S.netError = false;
      S.vetoOff = false;
      S.vetoSel = null;
      const fields = vetoFields(r.match);
      if (Object.keys(fields).length && S.ref && Array.isArray(S.ref.matches)) {
        S.vetoPatch.set(no, { at: Date.now(), fields });
        S.ref.matches = mergeVeto(S.ref.matches, no, fields);
        writeCache();
      } else reload();
      const cur = effective().find((x) => x.no === no);
      if ((action === 'ban' || action === 'pick') && cur && vetoState(cur, mapPool(store.get())).done) {
        // сүүлийн алхам: дүнг бүтнээр нь харуулна (тоглолт эхлэх хүртэл / «Хураах» хүртэл); Bo3 — тал сонгох + JSON
        S.vetoView = { no, status: cur.status, open: true };
      }
      renderAll();
      refreshVeto();
      if (okText) toast(okText(r), 'ok', 4000);
      return r;
    }
    const code = r && r.error;
    if (code === 'bad_token' || code === 'expired') { invalidate(code); return null; }
    S.vetoSel = null;
    toast(vetoErrorText(r), code === 'stale' || (r && r.reason === 'first_set') ? 'warn' : 'err', 6000);
    refreshVeto();
    reload();   // stale / forbidden / taken → серверийн одоогийн төлөвийг харуулна
    return null;
  }

  return { start, destroy };
}
