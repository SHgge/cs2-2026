// Админы цэвэр туслах функцууд. DOM ашиглахгүй — Node-оор тестлэх боломжтой.
import { SITE_URL, TZ } from '../config.js';
import { EVENT_NAME, DATES, FEE } from '../event.js';

/* ---------- CSV (UTF-8 BOM, formula-injection safe) ---------- */
export const CSV_BOM = '\uFEFF';
const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV cell. Text starting with = + - @ (or tab/CR) gets a leading apostrophe; RFC 4180 quoting. */
export function csvCell(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'Тийм' : 'Үгүй';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (FORMULA_START.test(s)) s = `'${s}`;
  if (/[",;\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** columns: ['a','b'] or [{key,label}]; rows: arrays (positional) or objects (by key). */
export function toCsv(columns, rows) {
  let cols = (columns || []).map((c) => (c && typeof c === 'object' ? { key: c.key, label: c.label ?? c.key } : { key: c, label: c }));
  const list = Array.isArray(rows) ? rows : [];
  if (!cols.length && list.length && list[0] && !Array.isArray(list[0])) cols = Object.keys(list[0]).map((k) => ({ key: k, label: k }));
  const lines = [cols.map((c) => csvCell(c.label)).join(',')];
  for (const r of list) {
    const vals = Array.isArray(r) ? r : cols.map((c) => (r == null ? null : r[c.key]));
    lines.push(vals.map(csvCell).join(','));
  }
  return `${CSV_BOM}${lines.join('\r\n')}\r\n`;
}

/* ---------- time (Asia/Ulaanbaatar = fixed UTC+8, no DST) ---------- */
const OFFSET_MS = 8 * 3600 * 1000;
const WD_SHORT = ['Ня', 'Да', 'Мя', 'Лх', 'Пү', 'Ба', 'Бя'];

function tzParts(iso) {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d);
  const o = Object.fromEntries(f.map((p) => [p.type, p.value]));
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[o.weekday];
  return { y: o.year, m: o.month, d: o.day, hh: o.hour === '24' ? '00' : o.hour, mm: o.minute, wd };
}

/** '10.23 (Ба)' */
export function shortDate(iso) { const p = tzParts(iso); return p ? `${p.m}.${p.d} (${WD_SHORT[p.wd]})` : ''; }
/** '10.23 (Ба) 17:00' */
export function shortDateTime(iso) { const p = tzParts(iso); return p ? `${p.m}.${p.d} (${WD_SHORT[p.wd]}) ${p.hh}:${p.mm}` : ''; }
/** '2026-10-13_1604' — for file names */
export function fileStamp(d = new Date()) { const p = tzParts(d); return p ? `${p.y}-${p.m}-${p.d}_${p.hh}${p.mm}` : 'x'; }

/** ISO → value for <input type="datetime-local"> in +08:00. */
export function isoToLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 16);
}
/** '2026-10-24T16:45' → '2026-10-24T16:45:00+08:00' (null if malformed). */
export function localInputToIso(v) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v || '') ? `${v}:00+08:00` : null;
}
export function isFuture(iso, now = Date.now()) { const t = Date.parse(iso || ''); return Number.isFinite(t) && t > now; }

/* ---------- links & messages ---------- */
/** Fallbacks when the live settings are not loaded (SPEC v5 §2): online registration = roster freeze. */
export const DEFAULT_REG_CLOSES = '2026-10-23T23:59:59+08:00';
export const REF_VALID_FROM = '2026-10-24T07:00:00+08:00';
export const REF_VALID_TO = '2026-10-25T18:00:00+08:00';

export const classLink = (token) => `${SITE_URL}#/k/${token}`;
export const refLink = (token) => `${SITE_URL}#/ref/${token}`;
export const siteLabel = () => SITE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');

/** 120000 → '120 000 ₮' (no-break spaces, same as ui.mnt; kept here so this module stays DOM-free). */
export function mntText(n) { return `${String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0')}\u00A0₮`; }

/** Team fee reminder for class teams (SPEC v5 §2a); the teachers' team pays no fee. */
export const feeLine = () => `Багийн хураамж ${mntText(FEE.team)} — ахлагч ${shortDateTime(DATES.fee_due_at)} хүртэл сургуулийн нягтлан бодогчид төлж, баримт авна.`;

/** Message the organiser forwards to a homeroom teacher → class chat (link only, no PIN). */
export function classLinkMessage(item, deadline) {
  if (item.is_teachers) {
    return `«${EVENT_NAME}» — Багш нарын багийн бүртгэл: ${classLink(item.token)}\n`
      + `Хугацаа: ${deadline}. Холбоосыг зөвхөн багийн гишүүдэд хуваалцана уу.`;
  }
  return `«${EVENT_NAME}» — ${item.name} багийн бүртгэл: ${classLink(item.token)}\n`
    + `Хугацаа: ${deadline}. Холбоосыг зөвхөн ангийн чатад хуваалцаарай.\n${feeLine()}`;
}
/** Teacher-only PIN line (sent separately from the link). The teachers' team PIN goes to its captain. */
export function pinMessage(item) {
  return item.is_teachers
    ? `${item.name} · Ахлагчийн PIN: ${item.pin} · Бусдад бүү өгнө үү.`
    : `${item.name} · Багшийн PIN: ${item.pin} · Сурагчдад бүү өгнө үү.`;
}

export function linksList(items, deadline) {
  const rows = items.filter((i) => i.token).map((i) => `${i.name}: ${classLink(i.token)}`);
  return `«${EVENT_NAME}» — бүртгэлийн холбоосууд (хугацаа ${deadline})\n${rows.join('\n')}\n`;
}
export function pinsList(items) {
  const rows = items.filter((i) => i.pin).map((i) => `${i.name}${i.is_teachers ? ' (ахлагч)' : ''}: ${i.pin}`);
  return `Багшийн PIN (сурагчдад бүү өгнө үү)\n${rows.join('\n')}\n`;
}

/* ---------- draw ---------- */
export const DRAW_GROUPS = ['A', 'B', 'V', 'G'];
/** Cyrillic seat letters used by _build/poster_huvaari.py (А Б В Г, U+0410..U+0413). */
export const SEAT_CYR = { A: 'А', B: 'Б', V: 'В', G: 'Г' };

export function bytesToHex(u8) { return Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join(''); }
export function randomSecretHex(bytes = 32, c = globalThis.crypto) {
  const u = new Uint8Array(bytes);
  c.getRandomValues(u);
  return bytesToHex(u);
}
export function normalizeSecret(s) { return String(s || '').toLowerCase().replace(/[\s\-:_.]/g, ''); }
export const isSecretHex = (s) => /^[0-9a-f]{64}$/.test(s || '');
/** All distinct 64-hex runs in a text (e.g. the downloaded secret .txt). */
export function hexCandidates(text) {
  return [...new Set((String(text || '').match(/[0-9a-fA-F]{64}/g) || []).map((s) => s.toLowerCase()))];
}
/** 'aaaaaaaa bbbbbbbb …' */
export function secretGroups(hex, size = 8) { return (String(hex || '').match(new RegExp(`.{1,${size}}`, 'g')) || []).join(' '); }

/** {A:[code,code,code],…} → {"А1":"12а",…} — the format of _build/draw.json. */
export function posterDrawJson(groups, teams) {
  const byCode = new Map((teams || []).map((t) => [t.code, t]));
  const out = {};
  for (const g of DRAW_GROUPS) {
    for (let i = 0; i < 3; i += 1) {
      const code = groups && groups[g] ? groups[g][i] : null;
      out[`${SEAT_CYR[g]}${i + 1}`] = code ? ((byCode.get(code) || {}).name || code) : '';
    }
  }
  return out;
}

export function drawCsvRows(groups, teams) {
  const byCode = new Map((teams || []).map((t) => [t.code, t]));
  const rows = [];
  for (const g of DRAW_GROUPS) {
    (groups && groups[g] ? groups[g] : []).forEach((code, i) => {
      const t = byCode.get(code) || {};
      rows.push([`${SEAT_CYR[g]} хэсэг`, `${SEAT_CYR[g]}${i + 1}`, t.name || code, `${i + 1}-р сагс`]);
    });
  }
  return { columns: ['Хэсэг', 'Суудал', 'Баг', 'Сагс'], rows };
}

/** Manual groups check: every group 3 seats, seat k from pot k, each team once. Returns error text or null. */
export function manualGroupsError(groups, teams) {
  const byCode = new Map((teams || []).map((t) => [t.code, t]));
  const seen = new Set();
  for (const g of DRAW_GROUPS) {
    const arr = (groups && groups[g]) || [];
    for (let i = 0; i < 3; i += 1) {
      const code = arr[i];
      if (!code) return 'Бүх суудлыг бөглөнө үү.';
      const t = byCode.get(code);
      if (!t) return 'Баг олдсонгүй.';
      if (Number(t.pot) !== i + 1) return `${t.name} — ${t.pot}-р сагсны баг. ${SEAT_CYR[g]}${i + 1} суудалд ${i + 1}-р сагсны баг орно.`;
      if (seen.has(code)) return `${t.name} хоёр удаа орсон байна.`;
      seen.add(code);
    }
  }
  return null;
}

/* ---------- consent aliases ---------- */
/** Alias for a player shown on stream/projector instead of the Steam name: «8а-Тоглогч3». */
export function aliasFor(team, slot) { return `${team.is_teachers ? 'Багш' : team.name}-Тоглогч${slot}`; }
/** Row 3а (projector) or 3б (online) not «Тийм» (false or not marked) → needs an alias. */
export const needsAlias = (p) => p.consent_3a !== true || p.consent_3b !== true;
export const playerId = (p) => (p.id != null ? p.id : p.player_id);
/**
 * Name shown in the game feed (MatchZy → hall projector AND stream): the Steam name only when BOTH rows 3а and 3б
 * are «Тийм»; otherwise the alias (or the automatic «8а-Тоглогч3»). Stricter than the SQL export (3б only).
 */
export function streamName(p, team) {
  if (!needsAlias(p)) return String(p.steam_nickname || '');
  return String(p.alias || '').trim() || aliasFor(team || { name: '' }, p.slot);
}
/** MatchZy export {code:{name, players:{steam_id64: display}}} with streamName() applied (teams = overview teams). */
export function matchzyWithAliases(mz, teams) {
  const byCode = new Map((teams || []).map((t) => [t.code, t]));
  const out = {};
  for (const [code, entry] of Object.entries(mz || {})) {
    const t = byCode.get(code);
    const players = {};
    for (const [sid, display] of Object.entries((entry && entry.players) || {})) {
      const p = t && (t.players || []).find((x) => String(x.steam_id64 || '') === sid);
      players[sid] = p ? streamName(p, t) : display;
    }
    out[code] = { ...entry, players };
  }
  return out;
}
/** Consent CSV (export kind 'consent'): recompute «Дамжуулалтад харагдах нэр» with streamName(). */
export function consentRowsWithAliases(columns, rows, teams) {
  const ix = (label) => (columns || []).indexOf(label);
  const [iTeam, iSlot, iSteam, i3a, i3b, iAlias, iShow] = ['Баг', '№', 'Steam нэр', '3а', '3б', 'Хоч нэр', 'Дамжуулалтад харагдах нэр'].map(ix);
  if (!Array.isArray(rows) || [iTeam, iSlot, iSteam, i3a, i3b, iAlias, iShow].some((i) => i < 0)) return rows;
  const byName = new Map((teams || []).map((t) => [t.name, t]));
  return rows.map((r) => {
    if (!Array.isArray(r)) return r;
    const p = {
      slot: Number(r[iSlot]), steam_nickname: r[iSteam], alias: r[iAlias],
      consent_3a: r[i3a] === 'Тийм', consent_3b: r[i3b] === 'Тийм',
    };
    const out = r.slice();
    out[iShow] = streamName(p, byName.get(r[iTeam]) || { name: String(r[iTeam] || '') });
    return out;
  });
}
/** Players that need an alias and have none → [{player_id, team_id, slot, alias}]. */
export function autoAliasPlan(teams) {
  const plan = [];
  for (const t of teams || []) {
    for (const p of t.players || []) {
      if (needsAlias(p) && !String(p.alias || '').trim() && playerId(p) != null) {
        plan.push({ player_id: playerId(p), team_id: t.id, slot: p.slot, alias: aliasFor(t, p.slot) });
      }
    }
  }
  return plan;
}

/* ---------- roster validation (mirrors the server rules, advisory only) ---------- */
const NAME_RE = /^[\p{Script=Cyrillic}\p{Script=Latin}][\p{Script=Cyrillic}\p{Script=Latin} -]{0,29}$/u; // starts with a letter (server rule)
const INITIAL_RE = /^[\p{Script=Cyrillic}\p{Script=Latin}]$/u;
export const STEAM_ID_RE = /^7656119\d{10}$/;

export function isBlankPlayer(p) {
  return !['first_name', 'surname_initial', 'steam_nickname', 'steam_id64'].some((k) => String((p && p[k]) || '').trim());
}

/** Field errors of one player: [{field, code}] */
export function playerErrors(p) {
  const e = [];
  const fn = String(p.first_name || '').trim();
  const si = String(p.surname_initial || '').trim().replace(/\.+$/, ''); // «Б.» = «Б» (server strips the dot)
  const nick = String(p.steam_nickname || '').trim();
  const sid = String(p.steam_id64 || '').trim();
  if (!fn) e.push({ field: 'first_name', code: 'required' });
  else if ([...fn].length > 30) e.push({ field: 'first_name', code: 'too_long' });
  else if (!NAME_RE.test(fn) || !/\p{L}/u.test(fn)) e.push({ field: 'first_name', code: 'invalid' });
  if (!si) e.push({ field: 'surname_initial', code: 'required' });
  else if (!INITIAL_RE.test(si)) e.push({ field: 'surname_initial', code: 'invalid' });
  const n = [...nick].length;
  if (!nick) e.push({ field: 'steam_nickname', code: 'required' });
  else if (n < 2) e.push({ field: 'steam_nickname', code: 'too_short' });
  else if (n > 32) e.push({ field: 'steam_nickname', code: 'too_long' });
  if (sid && !STEAM_ID_RE.test(sid)) e.push({ field: 'steam_id64', code: 'invalid' });
  return e;
}

/** players: [{slot,…}] (blank rows already removed) → {errors:[{slot,field,code}], count, captains} */
export function rosterCheck(players) {
  const errors = [];
  for (const p of players) for (const x of playerErrors(p)) errors.push({ slot: p.slot, ...x });
  const caps = players.filter((p) => p.is_captain);
  if (caps.length > 1) for (const p of caps) errors.push({ slot: p.slot, field: 'is_captain', code: 'multiple' });
  const dup = (key) => {
    const seen = new Map();
    for (const p of players) {
      const v = String(p[key] || '').trim().toLowerCase();
      if (!v) continue;
      if (seen.has(v)) { errors.push({ slot: p.slot, field: key, code: 'duplicate' }); errors.push({ slot: seen.get(v), field: key, code: 'duplicate' }); } else seen.set(v, p.slot);
    }
  };
  dup('steam_nickname');
  dup('steam_id64');
  return { errors, count: players.length, captains: caps.length };
}

/** Server validation codes (cs2 roster checks): required, invalid, too_long, too_short, duplicate, taken, multiple, missing. */
export const FIELD_ERROR_TEXT = {
  required: 'Бөглөнө үү',
  invalid: 'Хэлбэр буруу',
  too_long: 'Хэт урт',
  too_short: 'Хэт богино',
  duplicate: 'Давхардсан',
  taken: 'Өөр багт бүртгэлтэй',
  multiple: 'Ахлагч нэг л байна',
  missing: 'Дутуу',
};
const MAX_LEN = { first_name: 30, steam_nickname: 32, alias: 32, label: 60, secret: 200, text: 500, reason: 300 };
const FIELD_LABEL = {
  first_name: 'Нэр', surname_initial: 'Овгийн үсэг', steam_nickname: 'Steam нэр', steam_id64: 'SteamID64', is_captain: 'Ахлагч',
  age13: '13+ нас', slot: 'Тоглогч', players: 'Тоглогчид', reason: 'Шалтгаан', label: 'Нэр', secret: 'Нууц үг', text: 'Текст',
  stream_url: 'Холбоос', order: 'Дараалал', alias: 'Хоч нэр', until: 'Хугацаа', station: 'Станц', start: 'Цаг', status: 'Төлөв',
  commit: 'Commit', team: 'Баг', forfeit: 'Техникийн ялагдал', action: 'Үйлдэл', grp: 'Хэсэг', approved: 'Батлалт',
  locked: 'Түгжээ', level: 'Төрөл', kind: 'Төрөл', phase: 'Үе шат', confirm: '«УСТГАХ»', inputs: 'Тоонууд', groups: 'Хэсгүүд',
  consent_paper: '05', consent_3a: '3а', consent_3b: '3б', consent_3v: '3в', registration_open: 'Бүртгэл',
  reg_closes_at: 'Бүртгэл хаагдах', consent_deadline_at: 'Зөвшөөрлийн хугацаа', roster_freeze_at: 'Бүрэлдэхүүн царцах',
  tokens_valid_until: 'Холбоосын хугацаа',
};
/** Short Mongolian summary of server validation errors (first 3). */
export function validationText(errors) {
  const list = Array.isArray(errors) ? errors : [];
  const one = (e) => {
    const f = String(e.field || '');
    if (f === 'players' && e.code === 'count') return '5–6 тоглогч хэрэгтэй';
    if (f === 'slot' && e.code === 'missing') return `${e.slot}-р тоглогч дутуу`;
    if (f.startsWith('inputs.')) return `${f.slice(7)}: тоо буруу`;
    if (f.startsWith('groups.')) return 'Хэсгийн суудал буруу';
    if (f.startsWith('attest.')) return 'Баталгааны 4 зүйл дутуу';
    const who = e.slot ? `${e.slot}-р тоглогч — ` : '';
    return `${who}${FIELD_LABEL[f] || f}: ${fieldErrorText(f, e.code)}`;
  };
  const out = [...new Set(list.map(one))];
  return out.slice(0, 3).join('; ') + (out.length > 3 ? ' …' : '');
}

export function fieldErrorText(field, code) {
  if (code === 'invalid') {
    if (field === 'first_name') return 'Зөвхөн үсэг, зай, зураас';
    if (field === 'surname_initial') return 'Нэг үсэг';
    if (field === 'steam_id64') return '7656119-ээр эхэлсэн 17 оронтой тоо';
  }
  if (code === 'too_long') return `${MAX_LEN[field] || 32} хүртэл тэмдэгт`;
  if (code === 'too_short') return field === 'secret' ? '10-аас доошгүй тэмдэгт' : '2-оос доошгүй тэмдэгт';
  if (field === 'age13' && code === 'required') return '13 нас хүрсэн байх ёстой';
  if (field === 'is_captain' && code === 'missing') return 'Ахлагч сонгоно уу';
  if (field === 'label' && code === 'taken') return 'Ийм нэр бүртгэлтэй';
  return FIELD_ERROR_TEXT[code] || 'Шалгана уу';
}

/* ---------- scores & schedule labels ---------- */
/** forfeit = side that LOST by forfeit → 13:0 for the other side. */
export function forfeitScore(forfeit) {
  if (forfeit === 'a') return { a: 0, b: 13 };
  if (forfeit === 'b') return { a: 13, b: 0 };
  return null;
}
export const isKnockout = (stage) => stage === 'qf' || stage === 'sf' || stage === 'final' || stage === 'third';
export const isOvertime = (stage, a, b) => isKnockout(stage) && Number.isFinite(a) && Number.isFinite(b) && Math.max(a, b) > 13;
export function parseScore(v) { const s = String(v ?? '').trim(); return /^\d{1,2}$/.test(s) ? Number(s) : null; }

export function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }
