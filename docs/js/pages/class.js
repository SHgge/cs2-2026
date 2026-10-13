// Ангийн багийн хуудас — #/k/<token>
// Бүртгэл (6 тоглогч), ноорог, багшийн PIN баталгаажуулалт, зөвлөмж, хэвлэх, сугалааны дараа «Манай тоглолтууд».
// API-аас ирсэн өгөгдлийг ЗӨВХӨН ui.h (textContent)-ээр DOM-д оруулна. innerHTML ашиглахгүй.
import { classGet, classSave, classConfirm, errorText } from '../api.js';
import { h, fmtTime, fmtDate, fmtCountdown, toast, teamName, groupChip, stationLabel, copyText } from '../ui.js';
import { store } from '../store.js';
import { SCHOOL, CONTACT_NAME, CONTACT_PHONE } from '../config.js';

const TOKEN_KEY = 'cs2.k.token';
const DRAFT_PREFIX = 'cs2.k.draft.';
const DRAFT_TTL_MS = 14 * 24 * 3600 * 1000;
const POLL_MS = 60000;
const DEFAULT_CONSENT_AT = '2026-10-21T17:00:00+08:00';
const DEFAULT_REG_CLOSES = '2026-10-16T17:00:00+08:00';
const SLOTS = [1, 2, 3, 4, 5, 6];
const FIELDS = ['first_name', 'surname_initial', 'steam_nickname', 'steam_id64', 'is_captain', 'age13'];
const RE_LETTER = /[A-Za-zÀ-ÖØ-öø-ÿЀ-ӿ]/;
const RE_NAME = /^[A-Za-zÀ-ÖØ-öø-ÿЀ-ӿ][A-Za-zÀ-ÖØ-öø-ÿЀ-ӿ \-]{0,29}$/;
const RE_STEAMID = /^7656119\d{10}$/;
const ASSET = {
  f05: 'assets/docs/05_Zovshoorol.docx',
  f05b: 'assets/docs/05b_Nemelt_zovshoorol.docx',
  f06: 'assets/docs/06_Durem.docx',
};

/* ================================================================== pure helpers (Node-д тестлэгдэнэ) */

export function cleanToken(raw) {
  if (raw == null) return null;
  let t = String(raw);
  try { t = decodeURIComponent(t); } catch (e) { /* түүхий утгыг үлдээнэ */ }
  t = t.trim();
  return /^[\x21-\x7E]{6,256}$/.test(t) ? t : null;
}

/** «12а | » эсвэл «Багш | » */
export function steamPrefix(team) {
  return team && team.is_teachers ? 'Багш | ' : `${(team && team.name) || ''} | `;
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Хадгалсан бүтэн Steam нэрээс («12а | Бат») угтварыг хасаж «Бат»-ыг буцаана. */
export function splitNick(nick, team) {
  const s = String(nick == null ? '' : nick).trim();
  const head = team && team.is_teachers ? 'Багш' : String((team && team.name) || '');
  if (!head) return s;
  const m = s.match(new RegExp(`^${escapeRe(head)}\\s*\\|\\s*`, 'i'));
  return m ? s.slice(m[0].length) : s;
}

export function normName(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
export function normInitial(s) {
  const m = String(s == null ? '' : s).match(RE_LETTER);
  return m ? m[0].toUpperCase() : '';
}
export function normSteamPart(s, team) {
  const raw = String(s == null ? '' : s).replace(/^[\s|]+/, '');
  return splitNick(raw, team).replace(/^[\s|]+/, '').trim();
}
/** Цифр бичиж байгаа бол хэвээр; холбоос буулгасан бол 7656119… 17 оронтой тоог гаргаж авна. */
export function normSteamId(s) {
  const t = String(s == null ? '' : s).replace(/\s+/g, '');
  if (/^\d*$/.test(t)) return t;
  const m = t.match(/(?:^|\D)(7656119\d{10})(?!\d)/);
  return m ? m[1] : t;
}

export function emptySlot(slot) {
  return { slot, first_name: '', surname_initial: '', steam_part: '', steam_id64: '', is_captain: false, age13: false };
}

export function formFromPlayers(players, team) {
  const by = new Map();
  for (const p of Array.isArray(players) ? players : []) if (p) by.set(Number(p.slot), p);
  return SLOTS.map((slot) => {
    const p = by.get(slot);
    if (!p) return emptySlot(slot);
    return {
      slot,
      first_name: String(p.first_name || ''),
      surname_initial: String(p.surname_initial || ''),
      steam_part: splitNick(p.steam_nickname, team),
      steam_id64: String(p.steam_id64 || ''),
      is_captain: !!p.is_captain,
      age13: !!p.age13,
    };
  });
}

const cut = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
/** localStorage-аас уншсан ноорог (итгэлгүй өгөгдөл)-ийг 6 нүдтэй цэвэр загвар болгоно. */
export function sanitizeForm(list) {
  const by = new Map();
  for (const p of Array.isArray(list) ? list : []) {
    const slot = Number(p && p.slot);
    if (SLOTS.includes(slot) && !by.has(slot)) by.set(slot, p);
  }
  let captain = false;
  return SLOTS.map((slot) => {
    const p = by.get(slot) || {};
    const isCap = p.is_captain === true && !captain;
    if (isCap) captain = true;
    return {
      slot,
      first_name: cut(p.first_name, 60),
      surname_initial: cut(p.surname_initial, 3),
      steam_part: cut(p.steam_part, 64),
      steam_id64: cut(p.steam_id64, 120),
      is_captain: isCap,
      age13: p.age13 === true,
    };
  });
}

export function isEmptySlot(p) {
  return !normName(p.first_name) && !normInitial(p.surname_initial)
    && !String(p.steam_part || '').replace(/[\s|]+/g, '') && !normSteamId(p.steam_id64);
}

/** Өөрчлөлт илрүүлэх каноник түлхүүр. */
export function formKey(form, team) {
  return JSON.stringify((form || []).map((p) => (isEmptySlot(p) ? [p.slot] : [
    p.slot, normName(p.first_name), normInitial(p.surname_initial), normSteamPart(p.steam_part, team),
    normSteamId(p.steam_id64), !!p.is_captain, !!p.age13,
  ])));
}

const cpLen = (s) => Array.from(s).length;

/** CONTRACT §4-ийн серверийн шалгалтыг давтана. errs[slot][field] = code; warnings = хадгалахыг хаахгүй анхааруулга. */
export function validateForm(form, team) {
  const errs = {};
  const set = (slot, field, code) => { (errs[slot] = errs[slot] || {})[field] = code; };
  const prefix = steamPrefix(team);
  const filled = (form || []).filter((p) => !isEmptySlot(p));
  const nickSeen = new Map();
  const idSeen = new Map();
  for (const p of filled) {
    const fn = normName(p.first_name);
    if (!fn) set(p.slot, 'first_name', 'required');
    else if (!RE_NAME.test(fn)) set(p.slot, 'first_name', 'format');
    if (!normInitial(p.surname_initial)) set(p.slot, 'surname_initial', 'required');
    const part = normSteamPart(p.steam_part, team);
    if (!part) set(p.slot, 'steam_nickname', 'required');
    else {
      const full = prefix + part;
      const len = cpLen(full);
      if (len < 2 || len > 32) set(p.slot, 'steam_nickname', 'length');
      else {
        const k = full.toLowerCase();
        if (nickSeen.has(k)) { set(p.slot, 'steam_nickname', 'duplicate'); set(nickSeen.get(k), 'steam_nickname', 'duplicate'); } else nickSeen.set(k, p.slot);
      }
    }
    const id = normSteamId(p.steam_id64);
    if (id) {
      if (!RE_STEAMID.test(id)) set(p.slot, 'steam_id64', /steamcommunity\.com\/id\//i.test(String(p.steam_id64)) ? 'vanity' : 'format');
      else if (idSeen.has(id)) { set(p.slot, 'steam_id64', 'duplicate'); set(idSeen.get(id), 'steam_id64', 'duplicate'); } else idSeen.set(id, p.slot);
    }
  }
  const caps = (form || []).filter((p) => p.is_captain);
  for (const p of caps) if (isEmptySlot(p)) set(p.slot, 'is_captain', 'captain_empty');
  if (caps.length > 1) for (const p of caps) set(p.slot, 'is_captain', 'multi');
  const warnings = [];
  const starters = filled.filter((p) => p.slot <= 5).length;
  if (filled.length < 5) warnings.push({ code: 'count', n: filled.length });
  else if (starters < 5) warnings.push({ code: 'starter_gap' });
  if (filled.length && !caps.some((p) => !isEmptySlot(p))) warnings.push({ code: 'no_captain' });
  const noAge = filled.filter((p) => !p.age13).length;
  if (noAge) warnings.push({ code: 'age13', n: noAge });
  return { errs, warnings, count: filled.length, blocking: Object.keys(errs).length > 0 };
}

export function buildPayload(form, team, version, pin) {
  const prefix = steamPrefix(team);
  const players = (form || []).filter((p) => !isEmptySlot(p)).map((p) => {
    const o = {
      slot: p.slot,
      first_name: normName(p.first_name),
      surname_initial: normInitial(p.surname_initial),
      steam_nickname: prefix + normSteamPart(p.steam_part, team),
      is_captain: !!p.is_captain,
      age13: !!p.age13,
    };
    const id = normSteamId(p.steam_id64);
    if (id) o.steam_id64 = id;
    return o;
  });
  const payload = { expected_version: version, players };
  if (pin) payload.pin = String(pin);
  return payload;
}

const FIELD_ALIAS = {
  first_name: 'first_name', name: 'first_name', surname_initial: 'surname_initial', initial: 'surname_initial',
  steam_nickname: 'steam_nickname', nickname: 'steam_nickname', steam_name: 'steam_nickname',
  steam_id64: 'steam_id64', steam_id: 'steam_id64', steamid: 'steam_id64',
  is_captain: 'is_captain', captain: 'is_captain', age13: 'age13',
};

export function classifyCode(code) {
  const c = String(code || '').toLowerCase();
  if (/taken|exist|used/.test(c)) return 'taken';
  if (/dup|uniq/.test(c)) return 'duplicate';
  if (/req|empty|missing|blank/.test(c)) return 'required';
  if (/len|long|short|size|range/.test(c)) return 'length';
  if (/multi|many|more|captain/.test(c)) return 'multi';
  return 'format';
}

/** Серверийн validation алдааг талбар руу буулгана. */
export function mapServerErrors(list) {
  const errs = {};
  const general = [];
  for (const e of Array.isArray(list) ? list : []) {
    if (!e) continue;
    const field = FIELD_ALIAS[e.field] || e.field;
    const slot = e.slot == null ? null : Number(e.slot);
    if (slot && SLOTS.includes(slot) && FIELDS.includes(field)) (errs[slot] = errs[slot] || {})[field] = classifyCode(e.code);
    else general.push({ field: field || null, code: e.code || null, slot });
  }
  return { errs, general };
}

export function fieldMessage(field, code, isT) {
  const s = (kid, adult) => (isT ? adult : kid);
  switch (field) {
    case 'first_name':
      return code === 'required' ? s('Нэрийг бичээрэй.', 'Нэрийг бичнэ үү.')
        : s('Зөвхөн үсэг, зай, зураас бичээрэй (30 хүртэл).', 'Зөвхөн үсэг, зай, зураас бичнэ үү (30 хүртэл).');
    case 'surname_initial':
      return s('Овгийн эхний 1 үсгийг бичээрэй.', 'Овгийн эхний 1 үсгийг бичнэ үү.');
    case 'steam_nickname':
      if (code === 'required') return s('Steam нэрийг бичээрэй.', 'Steam нэрийг бичнэ үү.');
      if (code === 'duplicate') return s('Энэ Steam нэр багт давхардсан байна. Өөр нэр сонгоорой.', 'Энэ Steam нэр багт давхардсан байна. Өөр нэр сонгоно уу.');
      if (code === 'taken') return s('Энэ Steam нэрийг өөр тоглогч бүртгүүлсэн байна. Өөр нэр сонгоорой.', 'Энэ Steam нэрийг өөр тоглогч бүртгүүлсэн байна. Өөр нэр сонгоно уу.');
      if (code === 'format') return 'Steam нэрэнд тусгай удирдах тэмдэгт байж болохгүй.';
      return 'Steam нэр бүтнээрээ 2–32 тэмдэгт байна.';
    case 'steam_id64':
      if (code === 'duplicate') return 'Энэ SteamID багт давхардсан байна.';
      if (code === 'taken') return s('Энэ SteamID өөр тоглогчид бүртгэлтэй байна. Шалгаарай.', 'Энэ SteamID өөр тоглогчид бүртгэлтэй байна. Шалгана уу.');
      if (code === 'vanity') return s('Энэ холбоосоос ID гарахгүй. Account details-аас 17 оронтой тоог хуулаарай.', 'Энэ холбоосоос ID гарахгүй. Account details-аас 17 оронтой тоог хуулна уу.');
      return '7656119… гэж эхэлсэн 17 оронтой тоо байна.';
    case 'is_captain':
      return code === 'captain_empty' ? 'Ахлагчаар сонгосон нүд хоосон байна.' : 'Ахлагч зөвхөн нэг байна.';
    case 'age13':
      return isT ? 'Ажилтан, насанд хүрсэн эсэхийг тэмдэглэнэ үү.' : '13 нас хүрээгүй бол Steam-ээр тоглох боломжгүй.';
    default:
      return s('Мэдээллээ шалгаарай.', 'Мэдээллээ шалгана уу.');
  }
}

/** Ерөнхий (тоглогчид хамаарахгүй) анхааруулга / алдааны текст. */
export function generalMessage(item, isT) {
  const s = (kid, adult) => (isT ? adult : kid);
  const code = item && item.code;
  const n = item && item.n;
  switch (code) {
    case 'count': return n ? `Багт 5 эсвэл 6 тоглогч бүртгэнэ. Одоогоор ${n}.` : 'Багт 5 эсвэл 6 тоглогч бүртгэнэ.';
    case 'starter_gap': return s('Үндсэн 5 тоглогчийн (1–5) нүдийг бөглөөрэй.', 'Үндсэн 5 тоглогчийн (1–5) нүдийг бөглөнө үү.');
    case 'no_captain': return s('Ахлагчаа сонгоорой.', 'Ахлагчаа сонгоно уу.');
    case 'captain_multi': return 'Ахлагч зөвхөн нэг байна.';
    case 'age13': return isT ? `${n || ''} тоглогчийн «Ажилтан, 18+»-ийг тэмдэглээгүй байна.`.trim()
      : `${n || ''} тоглогчийн 13+ насыг тэмдэглээгүй байна.`.trim();
    case 'steam_id_missing': return s(`${n} тоглогчийн SteamID дутуу. 10.21 хүртэл нөхөж болно.`, `${n} тоглогчийн SteamID дутуу. 10.21 хүртэл нөхөж болно.`);
    default: break;
  }
  // серверийн ерөнхий алдаа {slot, field, code}
  const f = String((item && item.field) || '');
  const slot = item && item.slot;
  if (f === 'slot' && code === 'missing' && slot) return `${slot}-р тоглогчийн нүд хоосон байна.`;
  if (f === 'players' || f === 'slot' || f === 'count') return 'Багт 5 эсвэл 6 тоглогч бүртгэнэ (1–5 заавал).';
  if (f === 'is_captain') return s('Яг нэг ахлагч сонгоорой.', 'Яг нэг ахлагч сонгоно уу.');
  if (f === 'age13') return isT ? 'Бүх тоглогч насанд хүрсэн байна.' : 'Бүх тоглогч 13 ба түүнээс дээш настай байна.';
  if (f.startsWith('attest')) return '4 баталгааг бүгдийг тэмдэглэнэ үү.';
  if (f === 'steam_nickname') return s('Нэг Steam нэрийг өөр тоглогч бүртгүүлсэн байна. Шалгаарай.', 'Нэг Steam нэрийг өөр тоглогч бүртгүүлсэн байна. Шалгана уу.');
  if (f === 'steam_id64') return s('Нэг SteamID өөр тоглогчид бүртгэлтэй байна. Шалгаарай.', 'Нэг SteamID өөр тоглогчид бүртгэлтэй байна. Шалгана уу.');
  return s('Мэдээллээ шалгаарай.', 'Мэдээллээ шалгана уу.');
}

/** Серверт хадгалсан бүрэлдэхүүнээр баталгаажуулахад дутуу зүйлс. info:true = зөвхөн мэдээлэл. */
export function rosterIssues(players) {
  const list = Array.isArray(players) ? players : [];
  const out = [];
  const n = list.length;
  if (n < 5) { out.push({ code: 'count', n }); if (!n) return out; }
  else if (list.filter((p) => p.slot >= 1 && p.slot <= 5).length < 5) out.push({ code: 'starter_gap' });
  const caps = list.filter((p) => p.is_captain).length;
  if (caps === 0) out.push({ code: 'no_captain' }); else if (caps > 1) out.push({ code: 'captain_multi' });
  const noAge = list.filter((p) => !p.age13).length;
  if (noAge) out.push({ code: 'age13', n: noAge });
  const noId = list.filter((p) => !p.steam_id64).length;
  if (noId) out.push({ code: 'steam_id_missing', n: noId, info: true });
  return out;
}

export function progress(data) {
  const players = (data && Array.isArray(data.players)) ? data.players : [];
  const n = players.length;
  const consents = players.filter((p) => p.consent_paper).length;
  const checks = data && data.checks;
  const regDone = checks && typeof checks.complete === 'boolean'
    ? checks.complete : rosterIssues(players).filter((i) => !i.info).length === 0;
  const confDone = !!(data && data.confirmed_at);
  const consDone = n >= 5 && consents >= n;
  return { n, consents, consTotal: n >= 5 ? n : 6, regDone, confDone, consDone, ready: regDone && confDone && consDone };
}

export const _test = {
  cleanToken, steamPrefix, splitNick, normName, normInitial, normSteamPart, normSteamId, emptySlot, formFromPlayers,
  sanitizeForm, isEmptySlot, formKey, validateForm, buildPayload, classifyCode, mapServerErrors, fieldMessage,
  generalMessage, rosterIssues, progress,
};

/* ================================================================== storage, modal, PIN keypad */

function storageOf(kind) { try { return kind === 'local' ? window.localStorage : window.sessionStorage; } catch (e) { return null; } }
function sGet(kind, key) { try { const s = storageOf(kind); return s ? s.getItem(key) : null; } catch (e) { return null; } }
function sSet(kind, key, val) { try { const s = storageOf(kind); if (!s) return false; s.setItem(key, val); return true; } catch (e) { return false; } }
function sDel(kind, key) { try { const s = storageOf(kind); if (s) s.removeItem(key); } catch (e) { /* ignore */ } }

/** URL-ийн токенийг авч хаягаас арилгана (hashchange үүсгэхгүй), sessionStorage-д хадгална. */
function takeToken(arg, key, routeHash, allowLocal) {
  const fromUrl = cleanToken(arg);
  if (arg) { try { history.replaceState(null, '', routeHash); } catch (e) { /* ignore */ } }
  if (fromUrl) { sSet('session', key, fromUrl); return fromUrl; }
  const s = cleanToken(sGet('session', key));
  if (s) return s;
  if (allowLocal) {
    const l = cleanToken(sGet('local', key));
    if (l) { sSet('session', key, l); return l; }
  }
  return null;
}

const dt = (iso) => (iso ? `${fmtDate(iso)} ${fmtTime(iso)}` : '');
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

const finePointer = () => { try { return window.matchMedia('(hover: hover) and (pointer: fine)').matches; } catch (e) { return false; } };

/** 4 оронтой PIN-ийн товчлуур. 4 дахь цифр дээр onComplete(pin)-ийг автоматаар дуудна. */
function pinPad(onComplete) {
  let value = '';
  let disabled = false;
  let locked = false;
  let armed = true;
  const dots = h('div', { class: 'ops-pin-dots', 'aria-hidden': 'true' }, [0, 1, 2, 3].map(() => h('span', { class: 'ops-pin-dot' })));
  const msg = h('p', { class: 'ops-pin-msg', role: 'status', 'aria-live': 'polite' });
  const input = h('input', {
    class: 'ops-pin-input', type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '4', autocomplete: 'off',
    name: 'cs2-pin', 'aria-label': 'PIN код, 4 оронтой тоо', 'data-autofocus': finePointer() ? '' : null,
    oninput: () => set(input.value.replace(/\D/g, '').slice(0, 4)),
  });
  function set(v) {
    value = v;
    if (input.value !== v) input.value = v;
    Array.from(dots.children).forEach((d, i) => d.classList.toggle('on', i < v.length));
    if (v.length < 4) armed = true;
    if (v.length === 4 && armed && !disabled && !locked) {
      armed = false;
      setTimeout(() => onComplete(v), 150);
    }
  }
  const press = (d) => { if (disabled || locked || value.length >= 4) return; set(value + d); };
  const back = () => { if (disabled || locked) return; set(value.slice(0, -1)); };
  const key = (label, aria, fn, cls) => h('button', { type: 'button', class: `ops-key${cls ? ` ${cls}` : ''}`, 'aria-label': aria, onclick: fn }, label);
  const pad = h('div', { class: 'ops-keypad' },
    ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => key(d, d, () => press(d))),
    key('Арилгах', 'Бүгдийг арилгах', () => { if (!disabled && !locked) set(''); }, 'ops-key-sm'),
    key('0', '0', () => press('0')),
    key('⌫', 'Сүүлийн цифрийг арилгах', back, 'ops-key-sm'));
  const el = h('div', { class: 'ops-pin' }, input, dots, msg, pad);
  el.addEventListener('keydown', (e) => {
    if (e.target === input) return;
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); } else if (e.key === 'Backspace') { e.preventDefault(); back(); }
  });
  dots.addEventListener('click', () => { if (!disabled && !locked) input.focus(); });
  function refresh() {
    const off = disabled || locked;
    for (const b of pad.querySelectorAll('button')) b.disabled = off;
    input.disabled = off;
    el.classList.toggle('is-disabled', off);
  }
  return {
    el,
    clear() { set(''); },
    setMsg(text, kind) { msg.textContent = text || ''; msg.className = `ops-pin-msg${kind ? ` ${kind}` : ''}`; },
    setDisabled(b) { disabled = !!b; refresh(); },
    lock(text) { locked = true; refresh(); this.setMsg(text, 'err'); },
    shake() { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); },
  };
}

/* ================================================================== page */

export default async function render(root, params) {
  const page = createClassPage(root, params || {});
  page.start();
  return page.destroy;
}

function createClassPage(root, params) {
  const S = {
    dead: false, token: null, data: null, team: null, isT: false,
    base: null, baseVersion: null, form: null, offset: 0, loading: false,
    editUnlocked: false, showAll: false, touched: new Set(), serverErrs: null, serverGeneral: [],
    draftInfo: null, saving: false, reloadedFor: null, unsub: null, rendered: false,
    timers: { draft: 0, count: 0, poll: 0 },
  };
  const el = {};
  const prevTitle = document.title;
  const say = (kid, adult) => (S.isT ? adult : kid);

  /* ---------- lifecycle ---------- */
  async function start() {
    S.token = takeToken(params.arg, TOKEN_KEY, '#/k', true);
    if (!S.token) { renderNoToken(); return; }
    empty(root);
    root.appendChild(h('p', { class: 'muted loading' }, 'Ачаалж байна…'));
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flushDraft);
    window.addEventListener('afterprint', onAfterPrint);
    window.addEventListener('beforeprint', onBeforePrint);
    S.timers.poll = setInterval(() => { if (!document.hidden && S.token) load({ background: true }); }, POLL_MS);
    await load({});
  }

  function destroy() {
    if (S.dead) return;
    if (S.data) flushDraft();
    S.dead = true;
    clearTimeout(S.timers.draft);
    clearInterval(S.timers.count);
    clearInterval(S.timers.poll);
    if (S.unsub) { S.unsub(); S.unsub = null; }
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', flushDraft);
    window.removeEventListener('afterprint', onAfterPrint);
    window.removeEventListener('beforeprint', onBeforePrint);
    closeAllModals();
    document.title = prevTitle;
  }

  function onVisibility() {
    if (document.hidden) { flushDraft(); return; }
    if (S.data && S.token && !isDirty() && !openModals.size) load({ background: true });
  }

  /* ---------- data ---------- */
  async function load(opts) {
    if (S.loading || S.dead || !S.token) return;
    if (opts.background && (S.saving || openModals.size)) return;
    S.loading = true;
    let r = null;
    let net = false;
    try { r = await classGet(S.token); } catch (e) { net = true; }
    S.loading = false;
    if (S.dead) return;
    if (net) {
      if (!S.data) renderFatal('network');
      else if (!opts.background) toast(say('Интернэт холболтоо шалгаарай.', 'Интернэт холболтоо шалгана уу.'), 'err');
      return;
    }
    if (!r || !r.ok) {
      const code = r && r.error;
      if (code === 'bad_token' || code === 'expired') { invalidate(code); return; }
      if (!S.data) renderFatal(code || 'unknown', r);
      else if (!opts.background) toast(errorText(r), 'err');
      return;
    }
    if (opts.manual) toast('Шинэчлэгдлээ', 'ok', 1500);
    apply(r, opts);
  }

  function apply(r, opts) {
    const first = !S.data;
    const prevCanEdit = first ? null : canEdit();
    const prevNeedsPin = first ? null : needsPin();
    S.data = r;
    S.team = r.team || { id: null, code: 'x', name: '' };
    S.isT = !!S.team.is_teachers;
    if (r.now) { const t = Date.parse(r.now); if (!Number.isNaN(t)) S.offset = t - Date.now(); }
    document.title = `${S.team.name || 'Баг'} — бүртгэл · Ангийн аварга – CS2 2026`;
    const serverForm = formFromPlayers(r.players, S.team);
    const sameRoster = !first && r.version === S.baseVersion && formKey(serverForm, S.team) === formKey(S.base, S.team);
    if (!first && !opts.resetForm && isDirty()) {
      // Хэрэглэгчийн засварыг хадгална; хуучин хувилбарын дугаараар version_conflict илэрнэ.
      renderStatus(); renderWindow(); renderConfirm(); updateConsentChips();
      if (prevCanEdit !== canEdit()) renderForm();
      return;
    }
    if (!first && !opts.resetForm && sameRoster && prevCanEdit === canEdit() && prevNeedsPin === needsPin()) {
      renderStatus(); renderWindow(); renderConfirm(); updateConsentChips();
      return;
    }
    S.base = serverForm;
    S.baseVersion = r.version;
    S.form = serverForm.map((p) => ({ ...p }));
    S.serverErrs = null;
    S.serverGeneral = [];
    S.draftInfo = null;
    if (!opts.keepUnlock) S.editUnlocked = false;
    S.showAll = false;
    S.touched.clear();
    if (!opts.skipDraft) restoreDraft();
    renderAll();
  }

  function canEdit() {
    const w = (S.data && S.data.window) || {};
    return !!w.editable && (!needsPin() || S.editUnlocked);
  }
  function needsPin() {
    const w = (S.data && S.data.window) || {};
    return !!w.needs_pin || w.reason === 'confirmed';
  }
  function isDirty() { return !!(S.form && S.base) && formKey(S.form, S.team) !== formKey(S.base, S.team); }
  function serverPlayer(slot) { return ((S.data && S.data.players) || []).find((p) => Number(p.slot) === slot) || null; }

  function forgetToken() {
    sDel('session', TOKEN_KEY);
    if (sGet('local', TOKEN_KEY) === S.token) sDel('local', TOKEN_KEY);
  }
  /** Хүчингүй/хугацаа дууссан токен: санах ойгоос арилгаж, давтан дуудахгүй (ноорог үлдэнэ). */
  function invalidate(code) {
    if (S.data) flushDraft();
    forgetToken();
    S.token = null;
    S.data = null;
    clearInterval(S.timers.count);
    closeAllModals();
    renderFatal(code);
  }

  /* ---------- draft (localStorage, багийн кодоор) ---------- */
  function draftKey() { return DRAFT_PREFIX + ((S.team && S.team.code) || 'x'); }
  function scheduleDraft() { clearTimeout(S.timers.draft); S.timers.draft = setTimeout(flushDraft, 500); }
  function flushDraft() {
    clearTimeout(S.timers.draft);
    if (!S.form || !S.data || !S.team) return;
    if (isDirty()) sSet('local', draftKey(), JSON.stringify({ v: S.baseVersion, at: Date.now(), players: S.form }));
    else sDel('local', draftKey());
  }
  function readDraft() {
    const raw = sGet('local', draftKey());
    if (!raw) return null;
    try {
      const d = JSON.parse(raw);
      if (!d || !Array.isArray(d.players) || !(Date.now() - Number(d.at || 0) < DRAFT_TTL_MS)) { sDel('local', draftKey()); return null; }
      return d;
    } catch (e) { sDel('local', draftKey()); return null; }
  }
  function restoreDraft() {
    const d = readDraft();
    if (!d) return;
    const w = S.data.window || {};
    if (!w.editable) return; // засах боломжгүй үед хэрэглэхгүй (устгахгүй)
    const form = sanitizeForm(d.players);
    if (formKey(form, S.team) === formKey(S.base, S.team)) { sDel('local', draftKey()); return; }
    if (needsPin()) {
      const conf = Date.parse(S.data.confirmed_at || '');
      if (!Number.isNaN(conf) && Number(d.at) + S.offset < conf) { sDel('local', draftKey()); return; }
      S.editUnlocked = true;
    }
    S.form = form;
    S.draftInfo = { stale: d.v !== S.baseVersion, at: Number(d.at) };
  }
  function discardDraft() {
    sDel('local', draftKey());
    S.form = S.base.map((p) => ({ ...p }));
    S.draftInfo = null;
    S.editUnlocked = false;
    S.serverErrs = null;
    S.serverGeneral = [];
    S.showAll = false;
    S.touched.clear();
    renderDraftNote();
    renderForm();
    toast('Ноорог устгагдлаа.', 'ok');
  }

  /* ---------- render: frame ---------- */
  function renderAll() {
    const y = window.scrollY;
    empty(root);
    el.hero = heroCard();
    el.matches = h('section', { class: 'card k-matches', hidden: true, 'aria-labelledby': 'k-matches-h' });
    el.status = h('section', { class: 'card k-status', 'aria-labelledby': 'k-status-h' });
    el.window = h('div', { class: 'k-window' });
    el.draft = h('div', { class: 'card warn k-draftnote', role: 'status', hidden: true });
    el.form = h('section', { class: 'k-form', 'aria-labelledby': 'k-form-h' });
    el.confirm = h('section', { class: 'card k-confirm', 'aria-labelledby': 'k-confirm-h' });
    root.append(el.hero, el.matches, el.window, el.status, el.draft, el.form, el.confirm, toolsCard(), tipsSection());
    renderStatus();
    renderWindow();
    renderDraftNote();
    renderForm();
    renderConfirm();
    if (!S.unsub) S.unsub = store.subscribe((st) => renderMatches(st));
    else renderMatches(store.get());
    if (S.rendered) window.scrollTo(0, y);
    S.rendered = true;
  }

  function renderNoToken() {
    empty(root);
    root.appendChild(h('section', { class: 'card k-empty' },
      h('div', { class: 'k-empty-ico', 'aria-hidden': 'true' }, '▣'),
      h('h1', {}, 'Ангийнхаа QR кодыг уншуулаарай'),
      h('p', {}, 'Бүртгэлийн хуудас зөвхөн ангийн тусгай холбоосоор нээгдэнэ.'),
      h('p', {}, 'QR кодыг анги удирдсан багшаасаа аваарай. Утасныхаа камераар уншуулахад хуудас нээгдэнэ.'),
      h('p', { class: 'small muted' }, 'Багш нарын баг: QR кодыг зохион байгуулагчаас авна уу.'),
      h('div', { class: 'row k-empty-actions' },
        h('a', { class: 'btn secondary', href: '#/' }, 'Нүүр хуудас'),
        h('a', { class: 'btn secondary', href: '#/faq' }, 'Асуулт, хариулт'))));
  }

  function renderFatal(code, r) {
    if (S.dead) return;
    empty(root);
    let title = 'Алдаа гарлаа';
    let text = errorText(r || { error: code });
    let retry = true;
    if (code === 'network') { title = 'Холболт амжилтгүй'; text = 'Интернэтээ шалгаад дахин оролдоорой.'; }
    if (code === 'bad_token') { title = 'Холбоос хүчингүй байна'; text = 'Анги удирдсан багшаасаа шинэ QR код аваарай.'; retry = false; }
    if (code === 'expired') { title = 'Холбоосын хугацаа дууссан'; text = 'Энэ холбоос 10.25-ны 18:00 хүртэл хүчинтэй байсан.'; retry = false; }
    root.appendChild(h('section', { class: 'card error k-fatal', role: 'alert' },
      h('h1', {}, title), h('p', {}, text),
      code === 'bad_token' ? h('p', { class: 'small' }, 'Багш нарын баг: зохион байгуулагчаас шинэ QR код авна уу.') : null,
      h('div', { class: 'row' },
        retry ? h('button', { type: 'button', class: 'btn', onclick: () => { empty(root); root.appendChild(h('p', { class: 'muted loading' }, 'Ачаалж байна…')); load({}); } }, 'Дахин оролдох') : null,
        h('a', { class: 'btn secondary', href: '#/' }, 'Нүүр хуудас'))));
  }

  function heroCard() {
    const t = S.team;
    const remembered = sGet('local', TOKEN_KEY) === S.token;
    const cb = h('input', {
      type: 'checkbox', id: 'k-remember', checked: remembered,
      onchange: (e) => {
        if (e.target.checked) {
          if (sSet('local', TOKEN_KEY, S.token)) toast('Энэ төхөөрөмж холбоосыг сануулна.', 'ok', 2000);
          else { e.target.checked = false; toast('Энэ хөтөч дээр сануулах боломжгүй байна.', 'warn'); }
        } else { sDel('local', TOKEN_KEY); toast('Сануулахгүй боллоо.', 'info', 1500); }
      },
    });
    return h('header', { class: 'hero k-hero' },
      h('p', { class: 'k-kicker' }, 'Ангийн аварга – CS2 2026 · Бүртгэл'),
      h('h1', { class: 'k-team' }, S.isT ? (t.name || 'Багш нарын баг') : `${t.name} анги`),
      h('p', { class: 'muted k-sub' }, S.isT ? 'Зөвхөн танай багийн хуудас. Холбоосыг багийнхандаа л өгнө үү.'
        : 'Зөвхөн танай ангийн хуудас. Холбоосыг ангийнхандаа л хуваалцаарай.'),
      h('div', { class: 'k-hero-row' },
        h('label', { class: 'k-remember', for: 'k-remember' }, cb,
          h('span', {}, 'Энэ төхөөрөмж дээр сануулах', h('small', { class: 'k-remember-hint' }, say('Зөвхөн өөрийн утсанд', 'Зөвхөн хувийн төхөөрөмжид')))),
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn secondary k-mini', onclick: () => load({ manual: true }) }, 'Шинэчлэх'),
        h('button', { type: 'button', class: 'btn secondary k-mini', onclick: askLogout }, 'Гарах')));
  }

  function askLogout() {
    const m = openModal({
      title: 'Энэ төхөөрөмжөөс гарах уу?',
      body: [h('p', {}, 'Холбоос болон хадгалаагүй ноорог энэ төхөөрөмжөөс устна.'), h('p', { class: 'small muted' }, 'Дахин орохдоо QR кодоо уншуулна.')],
      actions: [
        h('button', { type: 'button', class: 'btn danger', onclick: () => { m.close(); logout(); } }, 'Гарах'),
        h('button', { type: 'button', class: 'btn secondary', 'data-autofocus': '', onclick: () => m.close() }, 'Болих'),
      ],
    });
  }
  function logout() {
    clearTimeout(S.timers.draft);
    if (S.team) sDel('local', draftKey());
    sDel('session', TOKEN_KEY);
    sDel('local', TOKEN_KEY);
    S.token = null;
    S.data = null;
    S.form = null;
    S.base = null;
    clearInterval(S.timers.count);
    if (S.unsub) { S.unsub(); S.unsub = null; }
    document.title = prevTitle;
    renderNoToken();
    toast('Энэ төхөөрөмжөөс гарлаа.', 'ok');
  }

  /* ---------- render: status steps ---------- */
  function consentDeadline() {
    const d = S.data && S.data.deadlines;
    if (d && d.consent_deadline_at) return d.consent_deadline_at;
    const st = store.get();
    return (st && st.settings && st.settings.consent_deadline_at) || DEFAULT_CONSENT_AT;
  }
  function regDeadline() {
    const d = S.data && S.data.deadlines;
    return (d && d.reg_closes_at) || DEFAULT_REG_CLOSES;
  }

  function renderStatus() {
    if (!el.status) return;
    const p = progress(S.data);
    empty(el.status);
    const cur = !p.regDone ? 1 : !p.confDone ? 2 : !p.consDone ? 3 : 4;
    const step = (no, done, title, meta, hint) => h('li', { class: `${done ? 'done' : ''}${cur === no && !done ? ' current' : ''}`.trim() },
      h('div', { class: 'k-step-body' },
        h('div', { class: 'k-step-title' }, h('span', {}, title), meta ? h('span', { class: 'k-step-meta' }, meta) : null),
        hint ? h('div', { class: 'k-step-hint small muted' }, hint) : null));
    add(el.status,
      h('h2', { id: 'k-status-h' }, 'Бүртгэлийн явц'),
      h('ol', { class: 'steps k-steps' },
        step(1, p.regDone, 'Бүртгэл', `${p.n}/6`, p.regDone ? null : say('5–6 тоглогч, 1 ахлагч, бүгд 13+ нас.', '5–6 тоглогч, 1 ахлагч.')),
        step(2, p.confDone, S.isT ? 'Ахлагч баталгаажуулсан' : 'Багш баталгаажуулсан', p.confDone ? dt(S.data.confirmed_at) : null,
          p.confDone ? null : (S.isT ? 'Багийн ахлагч PIN кодоор баталгаажуулна.' : 'Анги удирдсан багш PIN кодоор баталгаажуулна.')),
        step(3, p.consDone, S.isT ? 'Зөвшөөрөл (3а, 3б)' : 'Эцэг эхийн зөвшөөрөл', `${p.consents}/${p.consTotal}`,
          p.consDone ? null : (S.isT ? '«Хэвлэх» хуудсанд тоглогч бүр 3а, 3б-гээ тэмдэглэж, гарын үсэг зурна.'
            : `Маягт 05, 05б-г ${dt(consentDeadline())} цагаас өмнө багшдаа өгөөрэй.`)),
        step(4, p.ready, 'Бэлэн', null, p.ready ? 'Баг тэмцээнд бэлэн боллоо!' : null)));
    const issues = rosterIssues(S.data.players || []);
    const show = issues.filter((i) => (p.regDone ? i.info : true));
    if (show.length && (S.data.players || []).length) {
      el.status.append(h('ul', { class: 'k-issues' }, show.map((i) => h('li', { class: i.info ? 'info' : 'warn' }, generalMessage(i, S.isT)))));
    }
  }

  /* ---------- render: deadline / window messages ---------- */
  function contactLine() {
    const phone = String(CONTACT_PHONE || '');
    const digits = phone.replace(/[^\d+]/g, '');
    return h('p', { class: 'small k-contact' }, 'Холбоо барих: ', CONTACT_NAME, ', ',
      /\d{6,}/.test(digits) ? h('a', { href: `tel:${digits}` }, phone) : phone);
  }

  function renderWindow() {
    if (!el.window) return;
    clearInterval(S.timers.count);
    empty(el.window);
    const w = S.data.window || {};
    const reason = w.reason || (w.editable ? 'open' : 'closed');
    if (w.editable && w.closes_at) {
      const cd = h('div', { class: 'countdown k-countdown' });
      const box = h('div', { class: 'card k-deadline' },
        h('div', { class: 'k-deadline-label' }, reason === 'confirmed' ? 'Засах боломж дуусах хүртэл' : 'Бүртгэл хаагдах хүртэл'),
        cd, h('div', { class: 'small muted' }, `${dt(w.closes_at)} цагт хаагдана.`));
      el.window.append(box);
      const target = Date.parse(w.closes_at);
      const tick = () => {
        const ms = target - (Date.now() + S.offset);
        if (!(ms > 0)) {
          cd.textContent = 'Хаагдлаа';
          clearInterval(S.timers.count);
          if (S.reloadedFor !== w.closes_at) { S.reloadedFor = w.closes_at; setTimeout(() => load({}), 1500); }
          return;
        }
        cd.textContent = fmtCountdown(ms);
        box.classList.toggle('soon', ms < 24 * 3600 * 1000);
      };
      tick();
      S.timers.count = setInterval(tick, 1000);
    }
    const msg = windowMessage(reason);
    if (msg) {
      el.window.append(h('div', { class: `card ${msg.kind} k-wmsg`, role: 'status' },
        h('strong', {}, msg.title), h('p', {}, msg.text), msg.contact ? contactLine() : null));
    }
  }

  function windowMessage(reason) {
    switch (reason) {
      case 'confirmed':
        return {
          kind: 'ok', title: S.isT ? 'Баталгаажсан' : 'Багш баталгаажуулсан',
          text: S.isT ? 'Засах бол «Засах» дарна уу. Хадгалахад PIN хэрэгтэй, баталгаажуулалт цуцлагдана.'
            : 'Засах бол «Засах» дарна уу. Хадгалахад багшийн PIN хэрэгтэй, баталгаажуулалт цуцлагдана.',
        };
      case 'closed':
        return {
          kind: 'warn', title: 'Бүртгэл хаагдсан', contact: true,
          text: say('Одоо засах боломжгүй. Өөрчлөлтийг зохион байгуулагч багш хийнэ.',
            'Одоо засах боломжгүй. Өөрчлөлтийг зохион байгуулагчаар хийлгэнэ үү.'),
        };
      case 'locked':
        return {
          kind: 'warn', title: 'Бүртгэл түгжигдсэн', contact: true,
          text: say('Зохион байгуулагч түр түгжсэн. Асуух зүйл байвал зохион байгуулагчид хандаарай.',
            'Зохион байгуулагч түр түгжсэн. Асуух зүйл байвал зохион байгуулагчид хандана уу.'),
        };
      case 'frozen':
        return {
          kind: 'info', title: 'Бүрэлдэхүүн тогтсон', contact: true,
          text: 'Сугалаа явагдсан. Одоо зөвхөн бүртгэлтэй нөөц тоглогчоор солино.',
        };
      default:
        return null;
    }
  }

  function renderDraftNote() {
    if (!el.draft) return;
    empty(el.draft);
    if (!S.draftInfo) { el.draft.hidden = true; return; }
    el.draft.hidden = false;
    add(el.draft,
      h('strong', {}, 'Ноорог сэргээгдлээ'),
      h('p', {}, say('Энэ төхөөрөмжид хадгалаагүй өөрчлөлт байна. «Хадгалах» дарж илгээгээрэй.',
        'Энэ төхөөрөмжид хадгалаагүй өөрчлөлт байна. «Хадгалах» дарж илгээнэ үү.')),
      S.draftInfo.stale ? h('p', { class: 'small' }, say('Анхаар: энэ хооронд өөр хүн бүртгэлийг өөрчилсөн байна. Шалгаад хадгалаарай.',
        'Анхаар: энэ хооронд өөр хүн бүртгэлийг өөрчилсөн байна. Шалгаад хадгална уу.')) : null,
      h('button', { type: 'button', class: 'btn secondary', onclick: discardDraft }, 'Ноорог устгах'));
  }

  /* ---------- render: form ---------- */
  function renderForm() {
    if (!el.form) return;
    empty(el.form);
    el.inputs = {};
    el.errs = {};
    el.consent = {};
    el.saveBtn = null;
    el.saveState = null;
    const editable = canEdit();
    el.form.append(h('div', { class: 'k-form-head' },
      h('h2', { id: 'k-form-h' }, 'Багийн бүрэлдэхүүн'),
      h('p', { class: 'small muted' }, say('1–5 — үндсэн тоглогч, 6 — нөөц (заавал биш). Нэг тоглогч — нэг баг.',
        '1–5 — үндсэн тоглогч, 6 — нөөц (заавал биш). Зөвхөн сургуулийн ажилтан.'))));
    for (const p of S.form) el.form.append(playerCard(p, editable));
    el.general = h('div', { class: 'card warn k-general', role: 'alert', hidden: true });
    el.form.append(el.general);
    el.form.append(saveBar());
    refreshValidation();
    updateSaveState();
  }

  function playerCard(p, editable) {
    const slot = p.slot;
    const id = (f) => `k-p${slot}-${f}`;
    const title = slot <= 5 ? `Тоглогч ${slot}` : 'Нөөц тоглогч';
    const prefix = steamPrefix(S.team);
    const errEl = (field) => {
      const e = h('div', { class: 'field-error', id: `${id(field)}-err`, hidden: true });
      el.errs[`${slot}.${field}`] = e;
      return e;
    };
    const reg = (field, input) => { el.inputs[`${slot}.${field}`] = input; return input; };

    const name = reg('first_name', h('input', {
      id: id('first_name'), type: 'text', value: p.first_name, maxlength: '30', autocomplete: 'off', autocapitalize: 'words',
      spellcheck: 'false', enterkeyhint: 'next', placeholder: S.isT ? 'Жишээ: Болд' : 'Жишээ: Тэмүүлэн', disabled: !editable,
      'aria-describedby': `${id('first_name')}-err`,
      oninput: (e) => { p.first_name = e.target.value; changed(slot, 'first_name'); },
      onblur: (e) => { const v = normName(e.target.value); if (v !== e.target.value) { e.target.value = v; p.first_name = v; } touch(slot, 'first_name'); },
    }));
    const initial = reg('surname_initial', h('input', {
      id: id('surname_initial'), type: 'text', class: 'k-initial', value: p.surname_initial, maxlength: '3', autocomplete: 'off',
      autocapitalize: 'characters', spellcheck: 'false', enterkeyhint: 'next', placeholder: 'Б', disabled: !editable,
      'aria-describedby': `${id('surname_initial')}-err`,
      oninput: (e) => { const v = normInitial(e.target.value); if (v !== e.target.value) e.target.value = v; p.surname_initial = v; changed(slot, 'surname_initial'); },
      onblur: () => touch(slot, 'surname_initial'),
    }));

    const fullName = () => prefix + normSteamPart(p.steam_part, S.team);
    const preview = h('b', { class: 'k-preview-name' }, normSteamPart(p.steam_part, S.team) ? fullName() : `${prefix}…`);
    const steam = reg('steam_nickname', h('input', {
      id: id('steam_nickname'), type: 'text', value: p.steam_part, maxlength: String(Math.max(2, 32 - cpLen(prefix))),
      autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'next',
      placeholder: S.isT ? 'Болд' : 'Тэмүүлэн', disabled: !editable,
      'aria-describedby': `${id('steam')}-hint ${id('steam_nickname')}-err`,
      oninput: (e) => { p.steam_part = e.target.value; preview.textContent = normSteamPart(p.steam_part, S.team) ? fullName() : `${prefix}…`; changed(slot, 'steam_nickname'); },
      onblur: (e) => {
        const v = normSteamPart(e.target.value, S.team);
        if (v !== e.target.value) { e.target.value = v; p.steam_part = v; preview.textContent = v ? fullName() : `${prefix}…`; changed(slot, 'steam_nickname'); }
        touch(slot, 'steam_nickname');
      },
    }));
    const copyBtn = h('button', {
      type: 'button', class: 'btn secondary k-copy', 'aria-label': `${title}: Steam нэрийг хуулах`,
      onclick: () => {
        const part = normSteamPart(p.steam_part, S.team);
        if (!part) { toast(say('Эхлээд Steam нэрээ бичээрэй.', 'Эхлээд Steam нэрээ бичнэ үү.'), 'warn'); return; }
        copyText(prefix + part);
      },
    }, 'Хуулах');

    const counter = h('span', { class: 'k-counter', 'aria-hidden': 'true' });
    const updateCounter = () => {
      const v = String(p.steam_id64 || '');
      const show = /^\d+$/.test(v) && v.length < 17;
      counter.textContent = show ? `${v.length}/17` : '';
      counter.hidden = !show;
    };
    const sid = reg('steam_id64', h('input', {
      id: id('steam_id64'), type: 'text', inputmode: 'numeric', value: p.steam_id64, maxlength: '160', autocomplete: 'off',
      spellcheck: 'false', enterkeyhint: 'done', placeholder: '7656119…', disabled: !editable,
      'aria-describedby': `${id('sid')}-hint ${id('steam_id64')}-err`,
      oninput: (e) => { const v = normSteamId(e.target.value); if (v !== e.target.value) e.target.value = v; p.steam_id64 = v; updateCounter(); changed(slot, 'steam_id64'); },
      onblur: () => touch(slot, 'steam_id64'),
    }));
    updateCounter();

    const age = reg('age13', h('input', {
      type: 'checkbox', id: id('age13'), class: 'k-switch-input', checked: p.age13, disabled: !editable,
      onchange: (e) => { p.age13 = e.target.checked; changed(slot, 'age13'); },
    }));
    const cap = reg('is_captain', h('input', {
      type: 'radio', name: 'k-captain', id: id('cap'), checked: p.is_captain, disabled: !editable,
      onchange: (e) => {
        if (!e.target.checked) return;
        for (const q of S.form) q.is_captain = q.slot === slot;
        changed(slot, 'is_captain');
      },
    }));
    const chip = h('span', { class: 'chip k-consent', hidden: true });
    el.consent[slot] = chip;
    setConsentChip(slot);

    return h('div', { class: `card k-player${slot === 6 ? ' k-reserve' : ''}`, role: 'group', 'aria-labelledby': id('title'), dataset: { slot: String(slot) } },
      h('div', { class: 'k-player-head' },
        h('h3', { class: 'k-player-title', id: id('title') }, title),
        h('span', { class: 'spacer' }),
        h('label', { class: 'k-cap', for: id('cap') }, cap, h('span', {}, 'Ахлагч'))),
      h('div', { class: 'k-player-sub' }, chip, slot === 6 ? h('span', { class: 'k-opt' }, 'Заавал биш') : null),
      errEl('is_captain'),
      h('div', { class: 'k-grid' },
        h('div', { class: 'k-f' }, h('label', { for: id('first_name') }, 'Нэр'), name, errEl('first_name')),
        h('div', { class: 'k-f k-f-init' }, h('label', { for: id('surname_initial') }, 'Овгийн эхний үсэг'), initial, errEl('surname_initial'))),
      h('div', { class: 'k-f' },
        h('label', { for: id('steam_nickname') }, 'Steam нэр'),
        h('div', { class: 'k-steam' }, h('span', { class: 'k-prefix', 'aria-hidden': 'true' }, prefix.trim()), steam, copyBtn),
        h('div', { class: 'small muted k-hint', id: `${id('steam')}-hint` }, 'Steam-д: ', preview, say(' · «Хуулах» дараад Steam-д буулгаарай. Овгоо бичихгүй.', ' · «Хуулах» дараад Steam-д буулгана уу. Овог бичихгүй.')),
        errEl('steam_nickname')),
      h('div', { class: 'k-f' },
        h('label', { for: id('steam_id64') }, 'SteamID64 ', h('span', { class: 'k-opt' }, '(заавал биш)')),
        h('div', { class: 'k-sid' }, sid, counter),
        h('div', { class: 'small muted k-hint', id: `${id('sid')}-hint` }, '7656119… гэж эхэлсэн 17 оронтой тоо. 10.21-ний Steam дадлага хүртэл нөхөж болно.'),
        errEl('steam_id64')),
      h('div', { class: 'k-player-foot' },
        h('label', { class: 'k-switch', for: id('age13') }, age, h('span', { class: 'k-switch-ui', 'aria-hidden': 'true' }),
          h('span', { class: 'k-switch-text' }, S.isT ? 'Сургуулийн ажилтан, 18+ нас' : '13 ба түүнээс дээш настай')),
        editable ? h('button', { type: 'button', class: 'k-clear', 'aria-label': `${title}: мэдээллийг арилгах`, onclick: () => askClear(slot) }, 'Арилгах') : null),
      errEl('age13'));
  }

  function setConsentChip(slot) {
    const chip = el.consent && el.consent[slot];
    if (!chip) return;
    const sp = serverPlayer(slot);
    if (!sp) { chip.hidden = true; return; }
    chip.hidden = false;
    const ok = !!sp.consent_paper;
    chip.className = `chip k-consent ${ok ? 'ok' : 'none'}`;
    chip.textContent = ok ? 'Зөвшөөрөл ✓' : 'Зөвшөөрөл ирээгүй';
    chip.title = ok ? 'Зөвшөөрлийн цаас ирсэн' : 'Зөвшөөрлийн цаас хараахан ирээгүй';
  }
  function updateConsentChips() { for (const slot of SLOTS) setConsentChip(slot); }

  function askClear(slot) {
    const p = S.form.find((x) => x.slot === slot);
    if (!p) return;
    if (isEmptySlot(p) && !p.is_captain && !p.age13) return;
    const label = slot <= 5 ? `${slot}-р тоглогчийн` : 'Нөөц тоглогчийн';
    const m = openModal({
      title: 'Мэдээллийг арилгах уу?',
      body: h('p', {}, `${label} мэдээлэл хоосон болно. Хадгалах хүртэл серверт өөрчлөгдөхгүй.`),
      actions: [
        h('button', { type: 'button', class: 'btn danger', onclick: () => { m.close(); clearSlot(slot); } }, 'Арилгах'),
        h('button', { type: 'button', class: 'btn secondary', 'data-autofocus': '', onclick: () => m.close() }, 'Болих'),
      ],
    });
  }
  function clearSlot(slot) {
    const i = S.form.findIndex((x) => x.slot === slot);
    if (i < 0) return;
    S.form[i] = emptySlot(slot);
    for (const f of FIELDS) S.touched.delete(`${slot}.${f}`);
    if (S.serverErrs && S.serverErrs[slot]) delete S.serverErrs[slot];
    renderForm();
    scheduleDraft();
  }

  function touch(slot, field) { S.touched.add(`${slot}.${field}`); refreshValidation(); }

  function changed(slot, field) {
    if (S.serverErrs) {
      if (field === 'is_captain') for (const k of Object.keys(S.serverErrs)) delete S.serverErrs[k].is_captain;
      else if (S.serverErrs[slot]) delete S.serverErrs[slot][field];
    }
    S.serverGeneral = [];        // ерөнхий серверийн алдаа засвар хийсний дараа хуучирна
    refreshValidation();
    updateSaveState();
    scheduleDraft();
  }

  function refreshValidation() {
    if (!S.form || !el.errs) return null;
    const v = validateForm(S.form, S.team);
    for (const slot of SLOTS) {
      for (const f of FIELDS) {
        const key = `${slot}.${f}`;
        const errBox = el.errs[key];
        if (!errBox) continue;
        const local = v.errs[slot] && v.errs[slot][f];
        const server = S.serverErrs && S.serverErrs[slot] && S.serverErrs[slot][f];
        const code = local || server;
        const show = !!code && (!!server || S.showAll || S.touched.has(key) || f === 'is_captain');
        errBox.textContent = show ? fieldMessage(f, code, S.isT) : '';
        errBox.hidden = !show;
        const input = el.inputs[key];
        if (input && input.type !== 'checkbox' && input.type !== 'radio') {
          input.classList.toggle('input-error', show);
          if (show) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
        }
      }
    }
    if (el.general) {
      empty(el.general);
      const items = [];
      if (S.showAll) for (const w of v.warnings) items.push(generalMessage(w, S.isT));
      for (const g of S.serverGeneral || []) items.push(generalMessage(g, S.isT));
      el.general.hidden = !items.length;
      if (items.length) el.general.append(h('ul', {}, Array.from(new Set(items)).map((t) => h('li', {}, t))));
    }
    return v;
  }

  function focusFirstError() {
    for (const slot of SLOTS) {
      for (const f of FIELDS) {
        const box = el.errs && el.errs[`${slot}.${f}`];
        if (box && !box.hidden) {
          const input = el.inputs[`${slot}.${f}`];
          const target = input && !input.disabled ? input : box;
          try { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* ignore */ }
          if (input && !input.disabled) setTimeout(() => { try { input.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 250);
          return;
        }
      }
    }
    if (el.general && !el.general.hidden) { try { el.general.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* ignore */ } }
  }

  function saveBar() {
    const w = (S.data && S.data.window) || {};
    if (!w.editable) return h('div', { class: 'k-savebar-off', hidden: true });
    if (needsPin() && !S.editUnlocked) {
      return h('div', { class: 'k-savebar locked' },
        h('span', { class: 'k-savestate' }, S.isT ? 'Баталгаажсан. Засахад PIN хэрэгтэй.' : 'Баталгаажсан. Засахад багшийн PIN хэрэгтэй.'),
        h('button', { type: 'button', class: 'btn secondary', onclick: askUnlock }, 'Засах'));
    }
    el.saveState = h('span', { class: 'k-savestate', 'aria-live': 'polite' });
    el.saveBtn = h('button', { type: 'button', class: 'btn gold k-save', onclick: () => save() }, 'Хадгалах');
    return h('div', { class: 'k-savebar' }, el.saveState, el.saveBtn);
  }

  function updateSaveState() {
    if (!el.saveBtn || !el.saveState) return;
    const dirty = isDirty();
    el.saveBtn.disabled = !dirty || S.saving;
    el.saveBtn.textContent = S.saving ? 'Хадгалж байна…' : 'Хадгалах';
    el.saveState.textContent = S.saving ? 'Илгээж байна…' : dirty ? 'Хадгалаагүй өөрчлөлт байна' : 'Бүгд хадгалагдсан ✓';
    el.saveBtn.parentNode.classList.toggle('dirty', dirty);
  }

  function askUnlock() {
    const m = openModal({
      title: 'Баталгаажсан бүртгэлийг засах уу?',
      body: [
        h('p', {}, S.isT ? 'Хадгалахад PIN хэрэгтэй.' : 'Хадгалахад анги удирдсан багшийн PIN хэрэгтэй.'),
        h('p', { class: 'k-warn-text' }, S.isT ? 'Хадгалсны дараа баталгаажуулалт цуцлагдана. Дахин баталгаажуулна уу.'
          : 'Хадгалсны дараа баталгаажуулалт цуцлагдана. Багш дахин баталгаажуулна.'),
      ],
      actions: [
        h('button', { type: 'button', class: 'btn', 'data-autofocus': '', onclick: () => { m.close(); S.editUnlocked = true; renderForm(); focusFirstInput(); } }, 'Засах'),
        h('button', { type: 'button', class: 'btn secondary', onclick: () => m.close() }, 'Болих'),
      ],
    });
  }
  function focusFirstInput() {
    const input = el.inputs && el.inputs['1.first_name'];
    if (input && !input.disabled) setTimeout(() => { try { input.focus(); } catch (e) { /* ignore */ } }, 50);
  }

  /* ---------- save ---------- */
  async function save(pin) {
    if (S.saving || !canEdit()) return;
    S.showAll = true;
    const v = refreshValidation();
    if (v && v.blocking) {
      focusFirstError();
      toast(say('Улаанаар тэмдэглэсэн талбарыг засаарай.', 'Улаанаар тэмдэглэсэн талбарыг засна уу.'), 'err');
      return;
    }
    if (needsPin() && !pin) { openPinForSave(); return; }
    const r = await sendSave(pin);
    if (r && !r.ok) handleSaveError(r);
  }

  async function sendSave(pin) {
    S.saving = true;
    updateSaveState();
    flushDraft();
    let r;
    try { r = await classSave(S.token, buildPayload(S.form, S.team, S.baseVersion, pin)); } catch (e) { r = { ok: false, error: 'network' }; }
    S.saving = false;
    if (S.dead) return r;
    if (r && r.ok) {
      const wasConfirmed = !!S.data.confirmed_at;
      sDel('local', draftKey());
      S.serverErrs = null;
      S.serverGeneral = [];
      if (Array.isArray(r.players) && r.window) apply(r, { resetForm: true, skipDraft: true });
      else await load({ resetForm: true, skipDraft: true });
      const nowConfirmed = !!(S.data && S.data.confirmed_at);
      toast(wasConfirmed && !nowConfirmed
        ? (S.isT ? 'Хадгалагдлаа. Дахин баталгаажуулна уу.' : 'Хадгалагдлаа. Багш дахин баталгаажуулна уу.')
        : say('Хадгалагдлаа. Баярлалаа!', 'Хадгалагдлаа. Баярлалаа!'), 'ok');
    } else updateSaveState();
    return r;
  }

  function handleSaveError(r) {
    const code = r && r.error;
    switch (code) {
      case 'network':
        toast(say('Интернэт холболтоо шалгаад дахин оролдоорой. Ноорог хадгалагдсан.', 'Интернэт холболтоо шалгаад дахин оролдоно уу. Ноорог хадгалагдсан.'), 'err');
        break;
      case 'validation': {
        const mapped = mapServerErrors(r.errors);
        S.serverErrs = mapped.errs;
        S.serverGeneral = mapped.general;
        refreshValidation();
        focusFirstError();
        toast(say('Мэдээллээ шалгаарай.', 'Мэдээллээ шалгана уу.'), 'err');
        break;
      }
      case 'version_conflict': openConflict(r); break;
      case 'pin_required': case 'pin_wrong': case 'pin_locked':
        S.editUnlocked = true;
        openPinForSave(r);
        break;
      case 'bad_token': case 'expired':
        invalidate(code);
        break;
      case 'closed': case 'locked':
        toast(errorText(r), 'err', 6000);
        load({});
        break;
      default:
        toast(errorText(r), 'err');
    }
  }

  function openConflict(r) {
    flushDraft();
    const fresh = r && r.state && r.state.ok && Array.isArray(r.state.players) ? r.state : null;
    const m = openModal({
      title: 'Өөр хүн өөрчилсөн байна',
      body: [
        h('p', {}, 'Таныг засаж байх хооронд өөр хүн бүртгэлийг хадгалсан байна.'),
        h('p', {}, say('Таны өөрчлөлт энэ төхөөрөмжид ноорог болж үлдсэн. Шинэчлээд шалгаарай.', 'Таны өөрчлөлт энэ төхөөрөмжид ноорог болж үлдсэн. Шинэчлээд шалгана уу.')),
      ],
      actions: [
        h('button', {
          type: 'button', class: 'btn', 'data-autofocus': '',
          onclick: () => { m.close(); if (fresh) apply(fresh, { resetForm: true, keepUnlock: true }); else load({ resetForm: true, keepUnlock: true }); },
        }, 'Шинэчлэх'),
        h('button', { type: 'button', class: 'btn secondary', onclick: () => m.close() }, 'Хаах'),
      ],
    });
  }

  function lockText(until) {
    const t = until ? Date.parse(until) : NaN;
    if (!Number.isNaN(t) && t - (Date.now() + S.offset) < 24 * 3600 * 1000) return `PIN түр түгжигдсэн. ${fmtTime(until)} цагаас хойш дахин оролдоно уу.`;
    return 'PIN түгжигдсэн. Зохион байгуулагчид хандаж PIN-ээ сэргээлгэнэ үү.';
  }

  /** PIN-тэй холбоотой хариуг товчлуурын доор харуулна. true = харуулсан. */
  function pinError(pad, r) {
    const code = r && r.error;
    if (code === 'pin_wrong') {
      pad.clear(); pad.shake();
      pad.setMsg(r.attempts_left != null ? `PIN буруу. ${r.attempts_left} оролдлого үлдлээ.` : 'PIN буруу. Дахин оролдоно уу.', 'err');
      return true;
    }
    if (code === 'pin_locked') { pad.clear(); pad.lock(lockText(r.until)); return true; }
    if (code === 'pin_required') { pad.clear(); pad.setMsg('PIN кодоо оруулна уу.', 'err'); return true; }
    if (code === 'network') { pad.clear(); pad.setMsg('Интернэт холболтоо шалгаад дахин оролдоно уу.', 'err'); return true; }
    if (code === 'forbidden' && r.reason === 'no_pin') { pad.clear(); pad.lock('PIN код олгогдоогүй байна. Зохион байгуулагчид хандана уу.'); return true; }
    return false;
  }

  function openPinForSave(prev) {
    let busy = false;
    const pad = pinPad(async (pin) => {
      if (busy) return;
      busy = true;
      pad.setDisabled(true);
      pad.setMsg('Хадгалж байна…');
      const r = await sendSave(pin);
      busy = false;
      if (S.dead || m.closed) return;
      if (r && r.ok) { m.close(); return; }
      pad.setDisabled(false);
      if (!pinError(pad, r)) { m.close(); handleSaveError(r); }
    });
    const m = openModal({
      title: S.isT ? 'PIN код' : 'Багшийн PIN код',
      className: 'ops-modal-pin',
      body: [
        h('p', {}, S.isT ? 'Баталгаажсан бүртгэлийг өөрчилж байна. PIN кодоо оруулна уу.' : 'Баталгаажсан бүртгэлийг өөрчилж байна. Анги удирдсан багш PIN кодоо оруулна уу.'),
        h('p', { class: 'k-warn-text small' }, 'Хадгалсны дараа баталгаажуулалт цуцлагдаж, дахин баталгаажуулна.'),
        pad.el,
      ],
      actions: [h('button', { type: 'button', class: 'btn secondary', onclick: () => m.close() }, 'Болих')],
    });
    if (prev) pinError(pad, prev);
  }

  /* ---------- teacher confirmation ---------- */
  function renderConfirm() {
    if (!el.confirm) return;
    empty(el.confirm);
    const d = S.data;
    el.confirm.append(h('h2', { id: 'k-confirm-h' }, S.isT ? 'Баталгаажуулалт' : 'Багшийн баталгаажуулалт'));
    if (d.confirmed_at) {
      el.confirm.classList.add('ok');
      el.confirm.append(h('p', { class: 'k-confirmed' }, h('span', { class: 'k-check', 'aria-hidden': 'true' }, '✓'), ` Баталгаажсан: ${dt(d.confirmed_at)}`));
      return;
    }
    el.confirm.classList.remove('ok');
    const w = d.window || {};
    if (!w.editable) {
      el.confirm.append(h('p', { class: 'muted' }, 'Баталгаажаагүй. Одоо онлайнаар баталгаажуулах боломжгүй — зохион байгуулагчид хандана уу.'));
      return;
    }
    add(el.confirm,
      h('p', {}, S.isT ? 'Бүртгэл бүрэн болмогц багийн ахлагч 4 зүйлийг шалгаад PIN кодоор баталгаажуулна.'
        : 'Бүртгэл бүрэн болмогц анги удирдсан багш 4 зүйлийг шалгаад PIN кодоор баталгаажуулна.'),
      h('button', { type: 'button', class: 'btn block k-confirm-btn', onclick: startConfirm }, S.isT ? 'Баталгаажуулах' : 'Багш баталгаажуулах'),
      h('p', { class: 'small muted' }, S.isT ? 'PIN кодыг багийн ахлагч хадгална.' : 'PIN кодыг зөвхөн анги удирдсан багш мэднэ.'));
  }

  function attestItems() {
    if (S.isT) {
      return [
        ['enrolled', 'Бүх тоглогч сургуулийн ажилтан. Тухайн өдөр шүүгч, зохион байгуулагчаар ажиллахгүй.'],
        ['age13', 'Бүх тоглогч насанд хүрсэн.'],
        ['own_steam', 'Тоглогч бүр өөрийн Steam бүртгэлээр тоглоно.'],
        ['rules', 'Дүрэм, ёс зүйн код, аварга шалгаруулах журамтай танилцсан.'],
      ];
    }
    return [
      ['enrolled', `Бүх тоглогч ${S.team.name} ангид суралцдаг.`],
      ['age13', 'Бүх тоглогч 13 ба түүнээс дээш настай.'],
      ['own_steam', 'Тоглогч бүр өөрийн Steam бүртгэлээр тоглоно.'],
      ['rules', 'Тоглогчид дүрэм, ёс зүйн кодтой танилцсан.'],
    ];
  }

  function startConfirm() {
    if (isDirty()) {
      toast(say('Эхлээд өөрчлөлтөө хадгалаарай.', 'Эхлээд өөрчлөлтөө хадгална уу.'), 'warn');
      if (el.saveBtn) { try { el.saveBtn.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* ignore */ } }
      return;
    }
    const issues = rosterIssues(S.data.players || []).filter((i) => !i.info);
    if (issues.length) {
      const m = openModal({
        title: 'Бүртгэл бүрэн биш байна',
        body: [h('p', {}, 'Баталгаажуулахын өмнө дараахыг засна уу:'), h('ul', { class: 'k-issues' }, issues.map((i) => h('li', { class: 'warn' }, generalMessage(i, true))))],
        actions: [h('button', { type: 'button', class: 'btn', 'data-autofocus': '', onclick: () => m.close() }, 'Ойлголоо')],
      });
      return;
    }
    openConfirmModal();
  }

  function openConfirmModal() {
    const checks = {};
    let busy = false;
    let blocked = false;
    const hint = h('p', { class: 'small muted ops-pin-hint' }, '4 зүйлийг бүгдийг тэмдэглэсний дараа PIN оруулна.');
    const pad = pinPad(submit);
    let shown = false;
    const update = () => {
      const all = attestItems().every(([k]) => checks[k].checked);
      pad.setDisabled(!all || busy || blocked);
      hint.hidden = all;
      if (all && !shown) {
        shown = true;
        setTimeout(() => { try { pad.el.scrollIntoView({ block: 'end', behavior: 'smooth' }); } catch (e) { /* ignore */ } }, 50);
      }
    };
    const list = h('div', { class: 'ops-attest' }, attestItems().map(([k, text]) => {
      const cb = h('input', { type: 'checkbox', id: `k-att-${k}`, onchange: update });
      checks[k] = cb;
      return h('label', { class: 'ops-check', for: `k-att-${k}` }, cb, h('span', {}, text));
    }));
    const players = (S.data.players || []).slice().sort((a, b) => a.slot - b.slot);
    const roster = h('ol', { class: 'ops-roster' }, players.map((p) => h('li', {},
      h('span', {}, `${p.first_name} ${p.surname_initial}.`),
      p.is_captain ? h('span', { class: 'chip gold' }, 'Ахлагч') : null,
      Number(p.slot) === 6 ? h('span', { class: 'chip' }, 'Нөөц') : null)));
    async function submit(pin) {
      if (busy) return;
      busy = true;
      update();
      pad.setMsg('Шалгаж байна…');
      const attest = {};
      for (const [k] of attestItems()) attest[k] = !!checks[k].checked;
      let r;
      try { r = await classConfirm(S.token, pin, attest); } catch (e) { r = { ok: false, error: 'network' }; }
      busy = false;
      if (S.dead || m.closed) return;
      if (r && r.ok) {
        m.close();
        toast(S.isT ? 'Баталгаажлаа. Баярлалаа!' : 'Багш баталгаажууллаа. Баярлалаа!', 'ok');
        load({});
        return;
      }
      update();
      if (pinError(pad, r)) { if (r.error === 'pin_locked' || r.error === 'forbidden') blocked = true; update(); return; }
      pad.clear();
      if (r && r.error === 'validation') {
        const mapped = mapServerErrors(r.errors);
        const msgs = mapped.general.map((g) => generalMessage(g, true));
        for (const slot of Object.keys(mapped.errs)) for (const f of Object.keys(mapped.errs[slot])) msgs.push(`${slot}-р тоглогч: ${fieldMessage(f, mapped.errs[slot][f], true)}`);
        pad.setMsg(Array.from(new Set(msgs)).join(' ') || 'Бүртгэл бүрэн биш байна.', 'err');
        return;
      }
      if (r && (r.error === 'bad_token' || r.error === 'expired')) { invalidate(r.error); return; }
      if (r && (r.error === 'closed' || r.error === 'locked')) { blocked = true; update(); }
      pad.setMsg(errorText(r), 'err');
    }
    const m = openModal({
      title: S.isT ? `Баталгаажуулах — ${S.team.name}` : `Багш баталгаажуулах — ${S.team.name}`,
      className: 'ops-modal-pin',
      body: [
        h('p', {}, S.isT ? 'Багийн ахлагч доорх 4 зүйлийг шалгаад тэмдэглэнэ үү.' : 'Анги удирдсан багш доорх 4 зүйлийг шалгаад тэмдэглэнэ үү.'),
        h('details', { class: 'ops-roster-box' }, h('summary', {}, `Бүрэлдэхүүн (${players.length})`), roster),
        list, hint, pad.el,
      ],
      actions: [h('button', { type: 'button', class: 'btn secondary', onclick: () => m.close() }, 'Болих')],
    });
    update();
  }

  /* ---------- «Манай тоглолтууд» (сугалааны дараа) ---------- */
  function renderMatches(state) {
    const sec = el.matches;
    if (!sec || S.dead || !S.team) return;
    if (!state || !state.draw || state.draw.status !== 'published') { sec.hidden = true; return; }
    import('../logic.js').then((logic) => {
      if (S.dead || el.matches !== sec) return;
      let list = [];
      try { list = logic.teamSchedule(state, S.team.id) || []; } catch (e) { list = []; }
      empty(sec);
      sec.hidden = false;
      sec.append(h('h2', { id: 'k-matches-h' }, 'Манай тоглолтууд'));
      const groups = (state.draw && state.draw.groups) || {};
      const grp = Object.keys(groups).find((g) => Array.isArray(groups[g]) && groups[g].includes(S.team.code));
      if (grp) {
        const names = groups[grp].map((code) => { const t = (state.teams || []).find((x) => x.code === code); return t ? t.name : code; });
        sec.append(h('p', { class: 'k-mygroup' }, groupChip(grp), ' ', names.join(' · ')));
      }
      if (!list.length) sec.append(h('p', { class: 'muted' }, 'Тоглолт хараахан тодорхойгүй байна.'));
      else sec.append(h('ul', { class: 'k-mlist' }, list.map((mt) => matchRow(mt, state, logic))));
      add(sec,
        h('p', { class: 'small k-mnote' }, say('Тоглолтоос 15 минутын өмнө хүлээлгийн өрөөнд ирээрэй. 10 минутаас илүү хоцорвол 13 : 0 ялагдал.',
          'Тоглолтоос 15 минутын өмнө хүлээлгийн өрөөнд ирнэ үү. 10 минутаас илүү хоцорвол 13 : 0 ялагдал.')),
        h('nav', { class: 'k-links' }, h('a', { href: '#/schedule' }, 'Бүх хуваарь'), h('a', { href: '#/groups' }, 'Хэсгийн байр'), h('a', { href: '#/bracket' }, 'Хасагдах шат')));
    }).catch(() => { sec.hidden = true; });
  }

  function stageText(mt) {
    if (mt.stage === 'group') return null;
    if (mt.stage === 'qf') return `Шөвгийн 8 · ${mt.code || ''}`;
    if (mt.stage === 'sf') return `Шөвгийн 4 · ${mt.code || ''}`;
    if (mt.stage === 'final') return 'Финал';
    if (mt.stage === 'third') return '3-р байрын тоглолт';
    return mt.code || '';
  }

  function matchRow(mt, state, logic) {
    const myA = mt.team_a === S.team.id;
    const opp = myA ? mt.team_b : mt.team_a;
    const hasScore = (mt.status === 'reported' || mt.status === 'final') && mt.score_a != null && mt.score_b != null;
    let result = null;
    if (hasScore) {
      const mine = myA ? mt.score_a : mt.score_b;
      const theirs = myA ? mt.score_b : mt.score_a;
      const res = mine > theirs ? ['ok', 'Ялалт'] : mine < theirs ? ['err', 'Ялагдал'] : ['', 'Тэнцээ'];
      let score = '';
      try { score = logic.fmtScore(mt); } catch (e) { score = `${mt.score_a} : ${mt.score_b}`; }
      result = h('span', { class: 'k-mres' }, h('b', {}, score), h('span', { class: `chip ${res[0]}` }, res[1]), mt.status === 'reported' ? h('span', { class: 'small muted' }, ' шалгагдаж байна') : null);
    } else if (mt.status === 'live') result = h('span', { class: 'chip warn' }, 'Явагдаж байна');
    return h('li', { class: `k-m${mt.status === 'live' ? ' live' : ''}` },
      h('div', { class: 'k-mtime' }, h('b', {}, fmtTime(mt.start)), h('span', { class: 'small muted' }, fmtDate(mt.start))),
      h('div', { class: 'k-mmain' },
        h('div', { class: 'k-mteams' }, h('span', { class: myA ? 'me' : '' }, teamName(state, mt.team_a)), h('span', { class: 'muted' }, ' – '), h('span', { class: myA ? '' : 'me' }, teamName(state, mt.team_b))),
        h('div', { class: 'k-mmeta small muted' },
          mt.stage === 'group' && mt.grp ? groupChip(mt.grp) : h('span', { class: 'chip gold' }, stageText(mt)),
          ' ', stationLabel(mt.station), opp == null ? ' · өрсөлдөгч тодорхойгүй' : ''),
        result));
  }

  /* ---------- tools & print ---------- */
  function toolsCard() {
    return h('section', { class: 'card k-tools', 'aria-labelledby': 'k-tools-h' },
      h('h2', { id: 'k-tools-h' }, 'Хэвлэх, холбоос'),
      h('p', { class: 'small muted' }, S.isT
        ? 'Хураангуйг хэвлээд тоглогч бүр 3а, 3б-гээ тэмдэглэж, гарын үсэг зурна уу.'
        : 'Хураангуйг маягт 04 хэлбэрээр хэвлэж болно. Багш онлайнаар баталгаажуулсан бол цаас заавал биш.'),
      h('button', { type: 'button', class: 'btn secondary block', onclick: doPrint }, 'Хэвлэх'),
      h('nav', { class: 'k-links' },
        h('a', { href: '#/rules' }, 'Удирдамж'), h('a', { href: '#/schedule' }, 'Хуваарь'),
        h('a', { href: '#/faq' }, 'Асуулт, хариулт'), h('a', { href: '#/downloads' }, 'Маягт татах'), h('a', { href: '#/privacy' }, 'Хувийн мэдээлэл')));
  }

  function onAfterPrint() { const old = root.querySelector('.k-print'); if (old) old.remove(); }
  /** Ctrl+P шууд дарсан ч хураангуй хэвлэгдэнэ. */
  function onBeforePrint() { if (S.data && !S.dead && !root.querySelector('.k-print')) root.appendChild(buildPrint()); }

  function doPrint() {
    if (!S.data) return;
    if (isDirty()) toast(say('Хадгалаагүй өөрчлөлт хэвлэгдэхгүй. Эхлээд хадгалаарай.', 'Хадгалаагүй өөрчлөлт хэвлэгдэхгүй. Эхлээд хадгална уу.'), 'warn', 5000);
    onAfterPrint();
    root.appendChild(buildPrint());
    try { window.print(); } catch (e) { toast('Хэвлэх боломжгүй байна.', 'err'); }
  }

  function buildPrint() {
    const d = S.data;
    const t = S.team;
    const isT = S.isT;
    const bySlot = new Map((d.players || []).map((p) => [Number(p.slot), p]));
    const box = (v) => (v ? '☑' : '☐');
    const head = isT
      ? ['№', 'Нэр, овгийн үсэг', 'Steam нэр', 'SteamID64', 'Үүрэг', '3а', '3б', 'Гарын үсэг']
      : ['№', 'Нэр, овгийн үсэг', 'Steam нэр', 'SteamID64', 'Үүрэг', '13+', '05'];
    const rows = SLOTS.map((slot) => {
      const p = bySlot.get(slot);
      const role = `${slot <= 5 ? 'Тоглогч' : 'Нөөц'}${p && p.is_captain ? ' (А)' : ''}`;
      const cells = [
        h('td', { class: 'c' }, String(slot)),
        h('td', {}, p ? `${p.first_name} ${p.surname_initial}.` : ''),
        h('td', {}, p ? p.steam_nickname : steamPrefix(t)),
        h('td', { class: 'mono' }, p && p.steam_id64 ? p.steam_id64 : ''),
        h('td', {}, role),
      ];
      if (isT) cells.push(h('td', { class: 'c nowrap' }, '☐ Т ☐ Ү'), h('td', { class: 'c nowrap' }, '☐ Т ☐ Ү'), h('td', { class: 'kp-signcell' }, ''));
      else cells.push(h('td', { class: 'c' }, box(p && p.age13)), h('td', { class: 'c' }, box(p && p.consent_paper)));
      return h('tr', {}, cells);
    });
    const now = new Date(Date.now() + S.offset).toISOString();
    const dots = '.'.repeat(36);
    return h('section', { class: 'k-print', 'aria-hidden': 'true' },
      h('p', { class: 'kp-top' }, `${SCHOOL} · «Ангийн аварга – CS2 2026»`, h('span', {}, 'Маягт 04 · онлайн бүртгэлийн хураангуй')),
      h('h1', {}, isT ? 'УДИРДЛАГА, БАГШ НАРЫН БАГИЙН МЭДҮҮЛЭГ' : 'БАГИЙН МЭДҮҮЛЭГ'),
      h('p', { class: 'kp-sub' }, isT ? 'Багийн нэр: «Удирдлага, багш нарын баг»' : `Анги (бүлэг): ${t.name}   ·   Багийн нэр: «${t.name}»`),
      h('table', { class: 'kp-table' }, h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, x)))), h('tbody', {}, rows)),
      h('p', { class: 'kp-note' }, `(А) — ахлагч. 1–5 үндсэн, 6 нөөц тоглогч. Steam нэр «${steamPrefix(t)}Нэр» хэлбэртэй, овоггүй. `
        + (isT ? '3а — танхимын проектор, 3б — Facebook шууд дамжуулалт: тоглогч өөрөө Т (тийм) / Ү (үгүй) тэмдэглэж, гарын үсэг зурна. «Үгүй» бол хоч нэрээр харагдана.'
          : '05 — маягт 05, 05б ирсэн (зохион байгуулагч тэмдэглэнэ).')),
      h('p', { class: 'kp-status' }, d.confirmed_at
        ? `Онлайн баталгаажуулсан: ${dt(d.confirmed_at)}${isT ? '' : ' — цаасаар өгөх шаардлагагүй'}.`
        : 'Онлайн баталгаажуулаагүй — гарын үсэг зурж, хугацаанд нь өгнө үү.',
        `   ·   Хэвлэсэн: ${dt(now)}   ·   Хувилбар: ${d.version != null ? d.version : '—'}`),
      h('p', { class: 'kp-h' }, 'Баталгаа:'),
      h('ul', { class: 'kp-attest' }, attestItems().map(([, text]) => h('li', {}, `☐ ${text}`))),
      h('p', { class: 'kp-rule' }, 'Бүрэлдэхүүнийг 2026.10.22-ны техникийн зөвлөгөөн хүртэл өөрчилж болно; түүнээс хойш зөвхөн бүртгэлтэй нөөц тоглогчоор солино.'),
      isT
        ? h('div', { class: 'kp-sign' }, h('p', {}, `Багийн ахлагч: ${dots}   Гарын үсэг: ${dots}   Огноо: 2026.10.____`))
        : h('div', { class: 'kp-sign' },
          h('p', {}, `Багийн ахлагч: ${dots}   Гарын үсэг: ${dots}`),
          h('p', {}, `Багийн менежер (анги удирдсан багш): ${dots}   Утас: ${'.'.repeat(24)}`),
          h('p', {}, `Гарын үсэг: ${dots}   Огноо: 2026.10.____`)),
      h('p', { class: 'kp-deadline' }, `Хүлээлгэн өгөх хугацаа: ${dt(regDeadline())} — Зохион байгуулах хорооны нарийн бичиг ${CONTACT_NAME}.`),
      h('div', { class: 'kp-received' }, 'ХҮЛЭЭН АВСАН (Зохион байгуулах хороо): нарийн бичиг ........................   Огноо: 2026.10.____   Цаг: ____:____'));
  }

  /* ---------- tips (static content) ---------- */
  function tipsSection() {
    const tip = (title, items, extra) => h('details', { class: 'k-tip' }, h('summary', {}, title),
      h('ul', {}, items.filter(Boolean).map((x) => h('li', {}, x))), extra || null);
    const ext = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
    const isT = S.isT;
    return h('section', { class: 'k-tips', 'aria-labelledby': 'k-tips-h' },
      h('h2', { id: 'k-tips-h' }, 'Зөвлөмж'),
      tip('Steam бүртгэл үүсгэх', [
        isT ? 'Steam бүртгэл үнэгүй.' : 'Steam бүртгэл үнэгүй. 13 нас хүрсэн байх ёстой.',
        h('span', {}, 'Бүртгүүлэх: ', ext('https://store.steampowered.com/join', 'store.steampowered.com/join'),
          say(' — и-мэйлээрээ бүртгүүлээрэй.', ' — и-мэйлээрээ бүртгүүлнэ үү.')),
        'CS2 үнэгүй, Prime шаардлагагүй.',
        'Зөвхөн өөрийн бүртгэлээр тоглоно. Бүртгэл зээлэх, хуваалцахыг хориглоно.',
        'Нууц үгээ хэнд ч хэлэхгүй.',
      ]),
      tip('Steam Mobile ба QR нэвтрэлт', [
        say('Утсандаа Steam Mobile апп суулгаад, бүртгэлээрээ нэвтэрч аваарай.', 'Утсандаа Steam Mobile апп суулгаад, бүртгэлээрээ нэвтэрнэ үү.'),
        'Лабын компьютер дээр Steam-ийн нэвтрэх цонхонд QR код гарна.',
        say('Аппын Steam Guard хэсгээс QR-ыг уншуулж, «Approve» дараарай.', 'Аппын Steam Guard хэсгээс QR-ыг уншуулж, «Approve» дарна уу.'),
        say('«Remember me»-г үргэлж унтраалттай байлгаарай.', '«Remember me»-г үргэлж унтраалттай байлгана уу.'),
        'Нэвтрэх дадлага: 10.19–10.21, хичээлийн дараа.',
        say('Тоглолтын дараа Steam-ээс заавал гараарай.', 'Тоглолтын дараа Steam-ээс заавал гарна уу.'),
      ]),
      tip('Steam нэрээ өөрчлөх', [
        'Steam → профайл → Edit Profile → Profile Name.',
        say(`Дээрх «Хуулах» товчоор «${steamPrefix(S.team)}Нэр»-ийг хуулаад буулгаарай. Дараа нь Save дараарай.`,
          `Дээрх «Хуулах» товчоор «${steamPrefix(S.team)}Нэр»-ийг хуулаад буулгана уу. Дараа нь Save дарна уу.`),
        'Овог бичихгүй. Зохисгүй нэр, профайлын зураг хориотой.',
        'Тэмцээний үеэр нэр, зургаа шүүгчийн зөвшөөрөлгүй өөрчлөхгүй.',
        'Шууд дамжуулалтад зөвшөөрөөгүй бол Хорооноос олгосон хоч нэрээр тоглоно.',
      ]),
      tip('SteamID64 олох', [
        say('Steam апп эсвэл клиентэд баруун дээд буланд нэрээ дараад Account details-ыг нээгээрэй.',
          'Steam апп эсвэл клиентэд баруун дээд буланд нэрээ дараад Account details-ыг нээнэ үү.'),
        say('«Steam ID: 7656119…» гэсэн 17 оронтой тоог хуулаарай.', '«Steam ID: 7656119…» гэсэн 17 оронтой тоог хуулна уу.'),
        'Профайлын холбоос steamcommunity.com/profiles/7656119… байвал бүтнээр нь буулгаж болно. Тоо автоматаар танигдана.',
        '«/id/…» хэлбэрийн холбоосоос ID гарахгүй.',
        '10.21-ний Steam дадлага хүртэл нөхөж болно.',
      ]),
      tip('Тэмцээнд юу авчрах вэ', [
        'Цэнэглэсэн утас (Steam Mobile апптай). Тоглолтын үед утсаа шүүгчид хадгалуулна.',
        say('Steam-ийн нэвтрэх нэр, нууц үгээ мэдэж ирээрэй.', 'Steam-ийн нэвтрэх нэр, нууц үгээ мэдэж ирнэ үү.'),
        'Хүсвэл өөрийн хулгана, гар, чихэвч — программ суулгахгүй ажилладаг бол. Техникийн баг шалгана.',
        say('Тоглолтоос 15 минутын өмнө хүлээлгийн өрөөнд ирээрэй. 10 минутаас илүү хоцорвол 13 : 0 ялагдал.',
          'Тоглолтоос 15 минутын өмнө хүлээлгийн өрөөнд ирнэ үү. 10 минутаас илүү хоцорвол 13 : 0 ялагдал.'),
        'Эрчим хүчний ундаа авчрахгүй. Лабад хоол идэхгүй.',
      ]),
      isT
        ? tip('Зөвшөөрөл (3а, 3б)', [
          '«Хэвлэх» товчоор хураангуйг хэвлэнэ үү. 3а (танхимын проектор), 3б (Facebook шууд дамжуулалт)-д тоглогч бүр өөрөө Т/Ү тэмдэглэж, гарын үсэг зурна.',
          'Хуудсыг зохион байгуулагчид өгнө үү.',
          '«Үгүй» гэсэн тоглогч Хорооноос олгосон хоч нэрээр харагдана.',
          'Зохион байгуулагч хүлээн авмагц энд «Зөвшөөрөл ✓» гэж харагдана.',
        ])
        : tip('Эцэг эхийн зөвшөөрөл (05, 05б)', [
          'Маягт 05, 05б-г эцэг эх, асран хамгаалагчаараа бөглүүлж, гарын үсэг зуруулаарай. 18 нас хүрсэн бол өөрөө зурна.',
          `${dt(consentDeadline())} цагаас өмнө анги удирдсан багштаа өгөөрэй.`,
          'Зөвшөөрөлгүй бол тоглохгүй.',
          '05б-ийн 1-р хэсэг (цахим бүртгэл)-ийг бүгд бөглөнө. 2-р хэсгийг зөвхөн 05-ын хуучин хувилбарыг өгсөн бол бөглөнө.',
          'Зохион байгуулагч хүлээн авмагц энд «Зөвшөөрөл ✓» гэж харагдана.',
        ], h('p', { class: 'k-downloads' },
          h('a', { class: 'btn secondary', href: ASSET.f05, download: '' }, 'Маягт 05 татах'),
          h('a', { class: 'btn secondary', href: ASSET.f05b, download: '' }, 'Маягт 05б татах'))),
      tip('Хувийн мэдээлэл', [
        'Нэр, овгийн эхний үсэг, Steam нэр, SteamID-г зөвхөн тэмцээнд ашиглана. Овог, утас, төрсөн огноог оруулахгүй.',
        'Нийтийн хуудсанд зөвхөн ангийн нэр, хуваарь, оноо харагдана. Тоглогчийн нэр, SteamID харагдахгүй.',
        say('Энэ холбоосыг зөвхөн ангийнхандаа хуваалцаарай.', 'Энэ холбоосыг зөвхөн багийнхандаа өгнө үү.'),
        'Мэдээллийг Supabase Inc. (гадаадын үүлэн сервер)-д хадгална.',
        isT ? null : 'Эцэг эх чинь 05б-д «Зөвшөөрөхгүй» гэсэн бол энд нэрээ бичихгүй. Багшдаа хэлээрэй: цаасан маягт 04-өөр бүртгэж, системд зөвхөн хоч нэр бичнэ.',
        'Хадгалаагүй ноорог зөвхөн энэ төхөөрөмжид үлдэнэ. Хадгалсны дараа устна.',
        'Хувийн мэдээллийг 2026.12.31-нд устгана. Хүний хувийн мэдээлэл хамгаалах тухай хуулийн дагуу.',
      ], h('p', {}, h('a', { href: '#/privacy' }, 'Дэлгэрэнгүй'), ' · ', h('a', { href: ASSET.f06, download: '' }, 'Дүрэм, ёс зүйн код (06)'))));
  }

  return { start, destroy };
}
