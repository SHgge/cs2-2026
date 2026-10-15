// Шүүгчийн хуудас — #/ref/<token>
// Станцын тоглолтууд, «Эхэлсэн», оноо (±), техникийн ялагдал, нэмэлт цаг (OT), «… — Зөв үү?» баталгаа,
// интернэт тасарвал localStorage-ийн дараалал. Ерөнхий шүүгч (station null) 'final' хийнэ.
// API-аас ирсэн өгөгдлийг ЗӨВХӨН ui.h (textContent)-ээр DOM-д оруулна.
import { refGet, refReport, errorText } from '../api.js';
import { h, fmtTime, fmtDate, toast, teamName, stationLabel } from '../ui.js';
import { store } from '../store.js';
import { validScore, resolveMatches, fmtScore, srcLabel as logicSrcLabel } from '../logic.js';
import { MATCHES, GROUP_LABEL, EVENT_NAME } from '../event.js';

const TOKEN_KEY = 'cs2.ref.token';
const Q_PREFIX = 'cs2.ref.q.';
const CACHE_PREFIX = 'cs2.ref.cache.';
const CACHE_TTL_MS = 3 * 24 * 3600 * 1000;
const POLL_MS = 20000;
const RETRY_MS = 15000;
const KO = new Set(['qf', 'sf', 'final', 'third']);
const ACTIONS = ['live', 'report', 'final'];
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

export function validEntry(e) {
  return !!e && typeof e.id === 'string' && Number.isInteger(e.no) && ACTIONS.includes(e.action);
}

/** Дараалалд нэмнэ: шинэ 'report' нь ижил тоглолтын хуучин 'report'-ыг, шинэ 'final' нь хуучин 'final'-ыг орлоно. */
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
      if (e.action === 'live') { if (!isDone(out)) out.status = 'live'; } else {
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

export const _test = {
  cleanToken, tokenTag, isKnockout, isDone, statusKey, sortMatches, pickCurrent, stageLabel, srcLabel, sourceText, scoreHint,
  checkScore, validEntry, enqueueEntry, applyQueue, isTransient,
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
    let r = null;
    let err = null;
    try { r = await refGet(S.token); } catch (x) { err = x; }
    S.loading = false;
    if (S.dead) return;
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
    S.ref = r;
    if (r.now) { const t = Date.parse(r.now); if (!Number.isNaN(t)) S.offset = t - Date.now(); }
    updateResolved();
    writeCache();
    if (!el.head || !root.contains(el.head)) renderFrame();
    renderAll(!!manual);
    if (manual) toast('Шинэчлэгдлээ', 'ok', 1500);
  }

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
      try { r = await refReport(S.token, e.no, e.action, e.a, e.b, e.forfeit, e.ta, e.tb); } catch (x) { err = x; }
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
    if (code === 'invalid_score') return 'Оноо дүрэмд нийцэхгүй байна.';
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
    if (code === 'expired') { title = 'Холбоос идэвхгүй байна'; text = 'Шүүгчийн холбоос 10.24 07:00 – 10.25 18:00 хооронд ажиллана.'; retry = false; }
    const pending = S.q.slice();
    root.appendChild(h('section', { class: 'card error k-fatal', role: 'alert' },
      h('h1', {}, title), h('p', {}, text),
      pending.length ? h('div', { class: 'r-lost' },
        h('p', {}, h('b', {}, `Илгээгдээгүй ${pending.length} үйлдэл байна. Зохион байгуулагчид хэлнэ үү:`)),
        h('ul', {}, pending.map((e) => h('li', {}, e.action === 'live' ? `№${e.no}: эхэлсэн` : `№${e.no}: ${e.a} : ${e.b}${e.forfeit ? ' (техникийн)' : ''}${e.action === 'final' ? ' — эцсийн' : ''}`)))) : null,
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
    const fpList = JSON.stringify([S.sel, S.filter, list.map((m) => [m.no, m.status, m.score_a, m.score_b, m.forfeit, m.pending, sideName(m, 'a'), sideName(m, 'b')])]);
    if (force || fpList !== S.fp.list) { S.fp.list = fpList; renderList(list); }
    const m = list.find((x) => x.no === S.sel) || null;
    const fpDet = JSON.stringify([S.sel, m, m && sideName(m, 'a'), m && sideName(m, 'b'), S.busy, !!S.ref.chief, S.filter]);
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
      h('ul', {}, S.failures.map((f) => h('li', {}, `№${f.no} (${f.action === 'live' ? 'эхэлсэн' : f.action === 'final' ? 'эцсийн' : 'оноо'}): ${f.text}`))),
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
      h('span', { class: 'r-item-state' }, isDone(m) ? h('b', {}, scoreText(m)) : null, statusChip(m)))));
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

  function refreshDetailState() {
    const m = currentMatch();
    if (!m || !el.hint) return;
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
    el.hint = null; el.send = null; el.finalBtn = null; el.ot = null; el.late = null;
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
          h('p', { class: 'small muted' }, 'Дүн баталгаажсан. Өөрчлөх бол зохион байгуулагчид хандана уу.')),
        next ? h('button', { type: 'button', class: 'btn secondary block r-big', onclick: () => select(next.no) }, 'Дараагийн тоглолт →') : null);
      return;
    }

    if (!A.known || !B.known) {
      el.detail.append(h('p', { class: 'card warn r-unknown' }, 'Багууд хараахан тодорхойгүй. Ерөнхий шүүгчээс тодруулна уу.'));
    }
    if (key === 'scheduled') {
      el.detail.append(h('button', { type: 'button', class: 'btn block r-big r-live', disabled: S.busy, onclick: () => send({ no: m.no, action: 'live', a: null, b: null, forfeit: null, ta: null, tb: null }) }, '▶ Эхэлсэн'));
    }
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

  function pickForfeit(m) {
    const A = side(m, 'a');
    const B = side(m, 'b');
    const md = openModal({
      title: 'Техникийн ялагдал',
      body: [
        h('p', {}, 'Аль баг техникийн ялагдал хүлээх вэ?'),
        h('p', { class: 'small muted' }, '10 минутаас илүү хоцорсон, ирээгүй эсвэл тоглох боломжгүй баг. Нөгөө баг 13 : 0 оноогоор ялна.'),
        h('div', { class: 'r-ff-choices' },
          h('button', { type: 'button', class: 'btn danger block r-big', onclick: () => { md.close(); confirmReport(m, 'report', 'a'); } }, A.name),
          h('button', { type: 'button', class: 'btn danger block r-big', onclick: () => { md.close(); confirmReport(m, 'report', 'b'); } }, B.name)),
      ],
      actions: [h('button', { type: 'button', class: 'btn secondary', 'data-autofocus': '', onclick: () => md.close() }, 'Болих')],
    });
  }

  function confirmReport(m, action, ff) {
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
    try { r = await refReport(S.token, item.no, item.action, item.a, item.b, item.forfeit, item.ta, item.tb); } catch (x) { err = x; }
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
      toast(item.action === 'live' ? 'Тоглолт эхэллээ.' : item.action === 'final' ? 'Эцэслэн баталгаажлаа.' : 'Оноо илгээгдлээ. Баярлалаа!', 'ok');
      await load(true);
      renderAll(true);
      return;
    }
    const code = r && r.error;
    if (code === 'bad_token' || code === 'expired') { invalidate(code); return; }
    toast(`№${item.no}: ${reportErrorText(r)}`, 'err', 6000);
    renderAll(true);
  }

  return { start, destroy };
}
