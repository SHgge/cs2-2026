// «Сургуулийн аварга – CS2 2026» — лобби дэлгэцийн урам зоригийн постер (#/screen, CONTRACT §6).
// Тогтмол 1920×1080 тайз дэлгэцэнд scale-аар багтана: дээд мөр, эргэлддэг слайд, баруун талд үе шатны тоолуур + QR,
// доод мөрөнд зарлал/уриа. Үе шат, слайдын жагсаалт, тоолуурын зорилтыг phase.js тодорхойлно.
// API өгөгдлийг зөвхөн textContent-ээр (ui.h) гаргана; innerHTML-ийг зөвхөн qr.js-ийн үүсгэсэн QR SVG ашиглана (CONTRACT §5).
// URL: ?static=1 (export: хөдөлгөөнгүй, тоолуурын оронд огноо, race/live слайдгүй) · ?slide=<id> · ?t=<ISO> (дуурайсан цаг)
//      ?rotate=<ms> (9000; 4000–30000) · ?safe=1 (ТВ-ийн ирмэгээс 3% зай) · ?debug=1 (хүрээ, үе шат, scale).
// Export-ийн дохио: html[data-screen-ready="1"], html[data-slides], html[data-phase], .scr-stage[data-slide].
import { h, clear, fmtTime, fmtDate } from '../ui.js';
import { store } from '../store.js';
import { BUILD, SITE_URL, SCHOOL, FB_PAGE, CONTACT_NAME, CONTACT_PHONES } from '../config.js';
import {
  PRIZES, FEE, GROUPS, GROUP_LABEL, GROUP_COLOR, STATION_LABEL, DATES, DRAW_AT, DAY_INFO, MATCHES, CHAMPION_TITLE,
} from '../event.js';
import {
  SLIDE_IDS, SLIDE_LABEL, TIMES, settingsOf, drawShown, regSummary, screenPhase, wavesOf, slidesFor, countdownFor,
} from '../phase.js';
import { groupStandings } from '../logic.js';
import {
  makeClock, mergedMatches, stationNowNext, sideInfo, isDone, isNow, winnerSide, scoreText, fallbackState,
  fmtDateShort, publicView, nameByCode, teamLabel,
} from './schedule.js';
import { placesOf } from './bracket.js';
import { loadQr, qrNode } from '../admin/qr.js';

const STAGE_W = 1920;
const STAGE_H = 1080;
const SVG_NS = 'http://www.w3.org/2000/svg';
const NBSP = '\u00A0';
const TICKER_MS = 6000;
const NUDGE_MS = 4 * 60 * 1000;
const NUDGE = [[0, 0], [6, 0], [6, 6], [0, 6], [-6, 6], [-6, 0], [-6, -6], [0, -6], [6, -6]];
const BUILD_CHECK_MS = 10 * 60 * 1000;
const STATE_WAIT_MS = 8000;
const VALVE_LINE = 'Valve-ийн албан ёсны тэмцээн биш';
const SITE_SHORT = SITE_URL.replace(/^https?:\/\//, '').replace(/\/+$/, '');
const GROUP_STATION = { A: 'A', V: 'A', B: 'B', G: 'B' };
const GEN = { 1: 'ийн', 2: 'ын', 3: 'ын', 4: 'ийн' };
/** Өгөгдөл өөрчлөгдөхөд дахин зурах слайдууд. */
const DATA_SLIDES = new Set(['race', 'groups', 'dates', 'live', 'standings', 'bracket', 'champion', 'day1', 'day2']);

// ---------- жижиг туслахууд ----------
const fmtNum = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
const money = (n) => `${fmtNum(n)}${NBSP}₮`;
const pad2 = (n) => String(Math.max(0, Math.floor(n))).padStart(2, '0');
const tms = (iso) => Date.parse(iso);
/** 10.23 (Ба) 17:00 — тасрахгүй зайтай (мөр хуваагдахад «17:00» ганцаараа үлдэхгүй). */
const dayTime = (iso) => `${fmtDateShort(iso)} ${fmtTime(iso)}`.replace(/ /g, NBSP);
/** Ангийн нэрийн үсгийг томоор: Oswald-д жижиг «б» нь «6» шиг харагддаг («11б» → «116»), «11Б» тодорхой. */
const classUp = (s) => (typeof s === 'string'
  ? s.replace(/(^|[^\p{L}\p{N}])(\d{1,2})([а-яёөү])(?!\p{L})/gu, (_, a, n, l) => `${a}${n}${l.toLocaleUpperCase('mn')}`)
  : s);
const weekday = (iso) => ((fmtDate(iso).match(/\(([^)]+)\)/) || [])[1] || '');
const raf2 = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
/** p эсвэл t мс (аль нь түрүүлж дуусна); дууссаны дараа таймер үлдэхгүй. */
const withTimeout = (p, t) => {
  let id = null;
  return Promise.race([p, new Promise((res) => { id = setTimeout(res, t); })]).finally(() => clearTimeout(id));
};
function reducedMotion() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } }
function onScreenRoute() { return (location.hash || '').replace(/^#\/?/, '').split(/[/?]/)[0] === 'screen'; }
function vars(el, map) { for (const [k, v] of Object.entries(map)) el.style.setProperty(k, v); return el; }
/** Element.append() null-ийг «null» текст болгодог тул шүүнэ. */
function add(el, ...kids) { for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c); return el; }

function readOptions(q) {
  const on = (v) => v === '1' || v === 'true' || v === 'yes';
  let t0 = null;
  if (typeof q.t === 'string' && q.t.trim()) {
    const v = Date.parse(q.t.trim().replace(/ /g, '+'));   // URLSearchParams '+' → ' ' болгодог
    if (Number.isFinite(v)) t0 = v;
  }
  const r = Number(q.rotate);
  return {
    isStatic: on(q.static),
    lock: SLIDE_IDS.includes(q.slide) ? q.slide : null,
    t0,
    rotate: q.rotate != null && Number.isFinite(r) && r > 0 ? Math.min(30000, Math.max(4000, Math.round(r))) : 9000,
    safe: on(q.safe),
    debug: on(q.debug),
  };
}

/** Бодит цаг (серверийн зөрүүг засна) эсвэл ?t=-ээс эхэлсэн дуурайсан цаг (static горимд зогсонги). */
function screenClock(opt) {
  if (opt.t0 == null) {
    const c = makeClock();
    return { now: () => c.now(), observe: (s) => c.observe(s), simulated: false };
  }
  const p0 = performance.now();
  return { now: () => (opt.isStatic ? opt.t0 : opt.t0 + Math.round(performance.now() - p0)), observe() {}, simulated: true };
}

// ---------- SVG дүрс (зэвсэггүй) ----------
function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const ICONS = {
  trophy: ['M7 4h10v5a5 5 0 0 1-10 0z', 'M7 6H4v1.5A3.5 3.5 0 0 0 7.5 11', 'M17 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5', 'M12 14v3.5', 'M8.5 21h7l-.9-3.5H9.4z'],
  medal: ['M7.5 2.5l3.2 6.4', 'M16.5 2.5l-3.2 6.4', { c: [12, 15, 6] }, 'M12 12.3l.8 1.7 1.9.3-1.35 1.3.3 1.9-1.65-.9-1.65.9.3-1.9-1.35-1.3 1.9-.3z'],
  users: [{ c: [9, 8, 3.5] }, 'M2.5 20.5a6.5 6.5 0 0 1 13 0', 'M15.5 4.6a3.5 3.5 0 0 1 0 6.8', 'M17.6 14a6.5 6.5 0 0 1 3.9 6.5'],
  calendar: [{ r: [3, 5, 18, 16, 2] }, 'M3 10h18', 'M8 3v4', 'M16 3v4'],
  monitor: [{ r: [2.5, 4, 19, 12.5, 1.5] }, 'M8 20.5h8', 'M12 16.5v4'],
  broadcast: [{ c: [12, 12, 2] }, 'M8.2 15.8a5.4 5.4 0 0 1 0-7.6', 'M15.8 8.2a5.4 5.4 0 0 1 0 7.6', 'M5.4 18.6a9.3 9.3 0 0 1 0-13.2', 'M18.6 5.4a9.3 9.3 0 0 1 0 13.2'],
  check: ['M4.5 12.5l5 5L19.5 7'],
  clock: [{ c: [12, 12, 9] }, 'M12 7v5l3.2 2'],
  star: ['M12 3.2l2.6 5.5 6 .8-4.4 4.2 1.1 6L12 16.8l-5.3 2.9 1.1-6-4.4-4.2 6-.8z'],
  phone: [{ r: [7, 2.5, 10, 19, 2] }, 'M11 18.5h2'],
  doc: ['M6 2.5h8l4 4v15H6z', 'M14 2.5v4h4', 'M9 12h6', 'M9 16h6'],
  ban: [{ c: [12, 12, 9] }, 'M5.7 5.7l12.6 12.6'],
  hourglass: ['M6.5 3h11', 'M6.5 21h11', 'M8 3c0 4.5 8 4.5 8 9s-8 4.5-8 9', 'M16 3c0 4.5-8 4.5-8 9s8 4.5 8 9'],
};

function icon(name, cls = '') {
  return svg('svg', {
    class: `scr-ico${cls ? ` ${cls}` : ''}`, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false',
  }, (ICONS[name] || []).map((p) => (typeof p === 'string' ? svg('path', { d: p })
    : p.c ? svg('circle', { cx: p.c[0], cy: p.c[1], r: p.c[2] })
      : svg('rect', { x: p.r[0], y: p.r[1], width: p.r[2], height: p.r[3], rx: p.r[4] || 0 }))));
}

let gradSeq = 0;
/** Том алтан цом (hero, champion). */
function bigTrophy(cls = '') {
  const id = `scr-gold-${++gradSeq}`;
  const fill = `url(#${id})`;
  return svg('svg', { class: `scr-trophy${cls ? ` ${cls}` : ''}`, viewBox: '0 0 240 270', 'aria-hidden': 'true', focusable: 'false' },
    svg('defs', {}, svg('linearGradient', { id, x1: 0, y1: 0, x2: 1, y2: 1 },
      svg('stop', { offset: '0', 'stop-color': '#FFE6A3' }),
      svg('stop', { offset: '.45', 'stop-color': '#F5A524' }),
      svg('stop', { offset: '1', 'stop-color': '#A9620A' }))),
    svg('path', { d: 'M64 56H34v22c0 25 17 41 40 43', fill: 'none', stroke: fill, 'stroke-width': 12, 'stroke-linecap': 'round' }),
    svg('path', { d: 'M176 56h30v22c0 25-17 41-40 43', fill: 'none', stroke: fill, 'stroke-width': 12, 'stroke-linecap': 'round' }),
    svg('path', { d: 'M62 34h116v72c0 38-26 64-58 64s-58-26-58-64z', fill }),
    svg('path', { d: 'M62 34h116v12H62z', fill: '#FFE6A3', opacity: '.55' }),
    svg('path', { d: 'M108 168h24v34h-24z', fill }),
    svg('path', { d: 'M96 200h48v10H96z', fill: '#C27A12' }),
    svg('path', { d: 'M78 210h84l9 30H69z', fill }),
    svg('path', { d: 'M60 240h120v18H60z', fill: '#8A520A' }),
    svg('path', { d: 'M120 72l6.2 17.5 18.5.5-14.7 11.2 5.3 17.8L120 108.5l-15.3 10.5 5.3-17.8-14.7-11.2 18.5-.5z', fill: '#FFF6DD', opacity: '.92' }),
    svg('path', { d: 'M80 50v50c0 20 7 35 18 46', fill: 'none', stroke: '#FFF6DD', 'stroke-width': 7, 'stroke-linecap': 'round', opacity: '.4' }));
}

const MEDAL = { 1: ['#FFE08A', '#C98A12'], 2: ['#EEF2F6', '#8E9BAA'], 3: ['#EFB07C', '#99541F'] };
/** Медаль: тууз + дугуй + байрын дугаар. */
function medalArt(n) {
  const id = `scr-medal-${++gradSeq}`;
  const [a, b] = MEDAL[n] || MEDAL[3];
  return svg('svg', { class: 'scr-medal', viewBox: '0 0 64 84', 'aria-hidden': 'true', focusable: 'false' },
    svg('defs', {}, svg('linearGradient', { id, x1: 0, y1: 0, x2: 1, y2: 1 },
      svg('stop', { offset: '0', 'stop-color': a }), svg('stop', { offset: '1', 'stop-color': b }))),
    svg('path', { d: 'M10 0h15l10 32H20z', fill: '#5AA9F0' }),
    svg('path', { d: 'M54 0H39L29 32h15z', fill: '#F5A524' }),
    svg('circle', { cx: 32, cy: 56, r: 25, fill: `url(#${id})` }),
    svg('text', { x: 32, y: 67, 'text-anchor': 'middle', 'font-size': 30, 'font-weight': 700, fill: '#20160A' }, String(n)));
}

/** «А» / «Б» станцын тэмдэг (бөмбөг тавих цэгийн хавтан шиг). */
function sitePlate(st, cls = '') {
  return h('div', { class: `scr-site site-${st === 'A' ? 'a' : 'b'}${cls ? ` ${cls}` : ''}` }, h('b', {}, st === 'A' ? 'А' : 'Б'));
}

// ---------- бүтцийн туслахууд ----------
const slideEl = (id, ...kids) => h('section', { class: `scr-slide s-${id}` }, kids);
const title = (text, cls = '') => h('h2', { class: `scr-h${cls ? ` ${cls}` : ''}` }, text);
const kick = (text) => h('div', { class: 'scr-kick' }, text);
const num = (n) => h('span', { class: 'scr-num', dataset: { count: String(n) } }, fmtNum(n));

/** Хоёр талын нэр нь тодорхойгүй (W:/L:) хасагдах шатны тоглолтод: «1/4-1, 1/4-2-ын ялагчид». */
function pairText(state, m) {
  const shown = (x) => ({ ...x, text: classUp(x.text) });
  const A = shown(sideInfo(state, m, 'a'));
  const B = shown(sideInfo(state, m, 'b'));
  if (!A.known && !B.known) {
    const ref = (src) => { const [k, v] = String(src || '').split(':'); return { k, base: MATCHES.find((x) => x.no === Number(v)) }; };
    const a = ref(m.src_a); const b = ref(m.src_b);
    if ((a.k === 'W' || a.k === 'L') && a.k === b.k && a.base && b.base) {
      const last = b.base.code || '';
      return { A, B, joined: `${a.base.code}, ${last}-${GEN[last.slice(-1)] || 'ийн'} ${a.k === 'W' ? 'ялагчид' : 'ялагдагчид'}` };
    }
  }
  return { A, B, joined: null };
}

function stageText(m) {
  if (m.stage === 'group') return `${GROUP_LABEL[m.grp] || m.grp} хэсэг`;
  if (m.stage === 'final') return 'Финал';
  if (m.stage === 'third') return '3-р байр';
  return m.code || '';
}

// ---------- хуудас ----------
export default async function render(root, params = {}) {
  const opt = readOptions((params && params.query) || {});
  const docEl = document.documentElement;
  const prevTranslate = docEl.getAttribute('translate');
  const restoreDoc = () => {
    docEl.classList.remove('scr-on');
    if (prevTranslate == null) docEl.removeAttribute('translate'); else docEl.setAttribute('translate', prevTranslate);
    delete docEl.dataset.screenReady;
    delete docEl.dataset.slides;
    delete docEl.dataset.phase;
  };

  // Загвар: index.html-д хүрэхгүй, энэ хуудас өөрөө ачаална.
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `css/screen.css?v=${BUILD}`;
  const cssReady = new Promise((res) => { link.onload = res; link.onerror = res; });
  document.head.appendChild(link);
  docEl.setAttribute('translate', 'no');
  docEl.classList.add('scr-on');
  delete docEl.dataset.screenReady;
  await withTimeout(cssReady, 6000);
  if (!onScreenRoute()) { link.remove(); restoreDoc(); return null; }

  const clock = screenClock(opt);
  let disposed = false;
  let state = null;
  let lastSeen = null;
  let armed = false;
  let booted = false;
  let phase = null;
  let list = [];
  let fullList = [];
  let idx = -1;
  let curId = null;
  let scale = 1;
  let nudgeI = 0;
  let cdKey = '';
  let cdParts = null;
  let tickerKey = '';
  let tickerItems = [];
  let tickerI = 0;
  let countRaf = 0;
  let stateWaiter = null;
  let wake = null;
  let idleT = null;
  const T = { rot: null, tick: null, ticker: null, nudge: null, build: null };

  // ---------- тайз ----------
  const stage = h('div', { class: 'scr-stage', dataset: { slide: '' } });
  const view = h('div', {
    class: `scr ${opt.isStatic ? 'scr-static' : 'scr-live'}${opt.debug ? ' scr-debug' : ''}`,
    role: 'region', 'aria-label': 'Лобби дэлгэц', translate: 'no',
  }, stage);
  vars(view, { '--rot': `${opt.rotate}ms` });

  const logo = h('img', { class: 'scr-logo', src: 'assets/img/logo-192.png', alt: '', width: '96', height: '96' });
  const head = h('header', { class: 'scr-head' },
    h('div', { class: 'scr-badge' }, logo),
    h('div', { class: 'scr-title' },
      h('div', { class: 'scr-name' }, 'Сургуулийн аварга', h('span', { class: 'scr-dash' }, ' – '), h('em', {}, 'CS2 2026')),
      h('div', { class: 'scr-school' }, SCHOOL)),
    h('div', { class: 'scr-when' }, h('b', {}, '10.24–25'), h('i', {}, '·'), h('span', {}, 'Бямба–Ням')));

  const tabNum = h('b', { class: 'scr-tab-n' }, '');
  const tabLabel = h('span', { class: 'scr-tab-l' }, '');
  const dots = h('div', { class: 'scr-dots', 'aria-hidden': 'true' });
  const timerBar = h('div', { class: 'scr-timer', 'aria-hidden': 'true' });
  const slot = h('div', { class: 'scr-slot' });
  const main = h('main', { class: 'scr-main hud' },
    h('div', { class: 'scr-radar', 'aria-hidden': 'true' }, h('i', { class: 'scr-sweep' })),
    h('div', { class: 'scr-tabbar' }, h('div', { class: 'scr-tab' }, tabNum, h('span', { class: 'scr-tab-sep' }, '·'), tabLabel), dots),
    timerBar, slot);

  const cdBox = h('section', { class: 'scr-cd hud' });
  const qrCap = h('div', { class: 'scr-qr-cap' }, '');
  const qrBox = h('div', { class: 'scr-qr-box' });
  const rail = h('aside', { class: 'scr-rail' }, cdBox,
    h('section', { class: 'scr-qrp hud' },
      h('div', { class: 'scr-qr-head' }, icon('phone'), qrCap),
      qrBox,
      h('div', { class: 'scr-url' }, SITE_SHORT),
      h('div', { class: 'scr-valve' }, VALVE_LINE)));

  const tickBox = h('div', { class: 'scr-tick' });
  const foot = h('footer', { class: 'scr-foot' }, tickBox,
    h('div', { class: 'scr-contact' }, 'Асуулт: ', h('b', {}, CONTACT_NAME), ` · утас ${CONTACT_PHONES.join(', ')}`));

  const dbgRead = h('b', { class: 'scr-dbg-read' }, '');
  stage.append(h('div', { class: 'scr-bg', 'aria-hidden': 'true' }), head, main, rail, foot);
  if (opt.debug) stage.append(h('div', { class: 'scr-dbg', 'aria-hidden': 'true' }, h('i', { class: 'scr-dbg-safe' }), dbgRead));

  clear(root);
  root.appendChild(view);
  document.body.classList.add('scr-mode');

  // ---------- масштаб, шилжилт ----------
  function layout() {
    const vw = window.innerWidth || STAGE_W;
    const vh = window.innerHeight || STAGE_H;
    const k = Math.min(vw / STAGE_W, vh / STAGE_H) * (opt.safe ? 0.94 : 1);
    const [nx, ny] = opt.isStatic ? [0, 0] : NUDGE[nudgeI % NUDGE.length];
    const x = Math.round(((vw - STAGE_W * k) / 2 + nx * k) * 100) / 100;
    const y = Math.round(((vh - STAGE_H * k) / 2 + ny * k) * 100) / 100;
    scale = k;
    stage.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
    updateDebug();
  }
  function updateDebug() {
    if (!opt.debug) return;
    const now = clock.now();
    dbgRead.textContent = `${phase || '—'} · ${curId || '—'} ${idx + 1}/${list.length} · scale ${scale.toFixed(3)} · `
      + `${window.innerWidth}×${window.innerHeight}${opt.safe ? ' safe' : ''} · ${new Date(now + 8 * 3600e3).toISOString().slice(5, 19).replace('T', ' ')}`
      + `${clock.simulated ? ' (t)' : ''}${opt.isStatic ? ' static' : ''}${store.status().error ? ` · сүлжээ: ${store.status().error}` : ''}`;
  }

  // ---------- слайдууд ----------
  const stat = (v, label, cls = '') => h('div', { class: `stat${cls ? ` ${cls}` : ''}` }, h('b', {}, v), h('span', {}, label));

  function placeCard(n) {
    const amt = PRIZES.place[n - 1];
    return h('div', { class: `pcard p${n}` },
      h('div', { class: 'pcard-h' }, medalArt(n), h('b', {}, `${n}-р байр`)),
      n === 1 ? h('div', { class: 'pcard-cup' }, icon('trophy'), h('span', {}, '«Сургуулийн аварга» цом')) : null,
      h('div', { class: 'pcard-amt' }, num(amt), h('span', { class: 'cur' }, '₮')),
      h('div', { class: 'pcard-per' }, `тоглогч бүрд ${money(PRIZES.per_player[n - 1])}`));
  }

  function raceRow(t) {
    const segs = Array.from({ length: 6 }, (_, i) => h('i', { class: i < t.players ? 'on' : '' }));
    // 0 тоглогч: хоосон (мөр бүдэг); 1–4: бүртгэж байна; 5–6: багш (багш нарын багт ахлагч) PIN-ээр батлах ёстой.
    const status = t.confirmed ? h('span', { class: 'rrow-s ok' }, icon('check'), 'Баталгаажсан')
      : !t.players ? h('span', { class: 'rrow-s' }, '')
        : t.players < 5 ? h('span', { class: 'rrow-s' }, 'Бүртгэж байна')
          : h('span', { class: 'rrow-s' }, t.is_teachers ? 'Батлаагүй' : 'Багш батлаагүй');
    return h('div', { class: `rrow${t.confirmed ? ' ok' : t.players ? ' part' : ' zero'}${t.is_teachers ? ' teach' : ''}` },
      h('div', { class: 'rrow-top' },
        h('b', { class: 'rrow-n' }, classUp(t.name) || '—'),
        h('span', { class: 'rrow-c' }, `${t.players}/6`),
        status),
      h('div', { class: 'segs' }, segs));
  }

  function groupBox(g, drawn) {
    const codes = drawn && state.draw.groups && Array.isArray(state.draw.groups[g]) ? state.draw.groups[g] : [];
    const names = [1, 2, 3].map((s) => (codes[s - 1] ? classUp(nameByCode(state, codes[s - 1])) : `${GROUP_LABEL[g]}${s}`));
    return vars(h('div', { class: 'grp' },
      h('div', { class: 'grp-l' }, GROUP_LABEL[g]),
      h('div', { class: 'grp-b' },
        h('div', { class: 'grp-st' }, `${GROUP_LABEL[g]} хэсэг · ${STATION_LABEL[GROUP_STATION[g]]}`),
        names.map((n) => h('div', { class: 'grp-t' }, n)))), { '--gc': GROUP_COLOR[g] });
  }

  /** Хуваарийн нүд. stacked = 2 мөр (хасагдах шат: нэр урт, мөр өндөр). */
  function matchCell(m, now, stackedIfKnown = false) {
    if (!m) return h('div', { class: 'sm empty' }, '—');
    const { A, B, joined } = pairText(state, m);
    const stacked = stackedIfKnown && (A.known || B.known);   // хоёулаа тодорхойгүй бол «А№1 – Б№2» нэг мөрөнд
    const done = isDone(m);
    const live = isNow(m, now);
    const win = done ? winnerSide(m) : null;
    const hasScore = done && m.score_a != null && m.score_b != null;
    const tag = m.stage === 'group'
      ? h('span', { class: 'sm-grp' }, GROUP_LABEL[m.grp] || m.grp)
      : h('span', { class: 'sm-tag' }, stageText(m));
    let body;
    if (joined) {
      body = h('span', { class: 'sm-t ph' }, joined);
    } else if (stacked) {
      const line = (side, info) => h('div', { class: `sm-l${win === side ? ' win' : win ? ' lost' : ''}` },
        h('span', { class: `sm-t${info.known ? '' : ' ph'}` }, info.text),
        h('b', {}, hasScore ? String(side === 'a' ? m.score_a : m.score_b) : ''));
      body = h('div', { class: 'sm-st' }, line('a', A), line('b', B));
    } else {
      body = [h('span', { class: `sm-t${A.known ? '' : ' ph'}${win === 'a' ? ' win' : ''}` }, A.text),
        h('span', { class: 'sm-vs' }, hasScore ? `${m.score_a}:${m.score_b}` : '–'),
        h('span', { class: `sm-t${B.known ? '' : ' ph'}${win === 'b' ? ' win' : ''}` }, B.text)];
    }
    const cell = h('div', { class: `sm${stacked ? ' stk' : ''}${live ? ' is-now' : ''}${done ? ' is-done' : ''}${m.stage === 'final' ? ' final' : ''}` }, tag, body);
    if (m.grp) vars(cell, { '--gc': GROUP_COLOR[m.grp] });
    return cell;
  }

  function daySlide(day) {
    const now = clock.now();
    const rows = mergedMatches(state);
    const byNo = new Map(rows.map((m) => [m.no, m]));
    const dkey = day === 1 ? '2026-10-24' : '2026-10-25';
    const keep = day === 1 ? ['12:45'] : ['12:00', '16:15'];
    const items = wavesOf(day).map((w) => ({ t: tms(w.start), w }));
    for (const [hhmm, text] of (DAY_INFO[day === 1 ? 'd1' : 'd2'] || [])) {
      if (keep.includes(hhmm)) items.push({ t: tms(`${dkey}T${hhmm}:00+08:00`), hhmm, text });
    }
    items.sort((a, b) => a.t - b.t);
    return slideEl(`day${day}`,
      h('div', { class: 'sch-top' },
        title(day === 1 ? '1-р өдөр' : '2-р өдөр'),
        h('div', { class: 'sch-sub' }, h('b', {}, fmtDate(`${dkey}T12:00:00+08:00`)), h('span', {}, day === 1 ? 'Хэсгийн шат' : 'Хасагдах шат'))),
      h('div', { class: 'sch' },
        h('div', { class: 'sch-h' }, h('span', {}, 'Цаг'),
          h('span', {}, sitePlate('A', 'xs'), STATION_LABEL.A), h('span', {}, sitePlate('B', 'xs'), STATION_LABEL.B)),
        items.map((it) => {
          if (!it.w) return h('div', { class: 'sch-r brk' }, h('b', { class: 'sch-t' }, it.hhmm), h('div', { class: 'sch-x' }, it.text));
          const ms = it.w.nos.map((no) => byNo.get(no)).filter(Boolean);
          const live = ms.some((m) => isNow(m, now));
          return h('div', { class: `sch-r${live ? ' is-now' : ''}` },
            h('b', { class: 'sch-t' }, live ? h('i', { class: 'sch-dot' }) : null, fmtTime(it.w.start)),
            matchCell(ms.find((m) => m.station === 'A'), now, day === 2),
            matchCell(ms.find((m) => m.station === 'B'), now, day === 2));
        })));
  }

  function liveCard(st, rows, now) {
    const { current, next, last } = stationNowNext(rows, st, now);
    const m = current || next || last;
    const tag = current ? 'Одоо' : next ? 'Дараа' : last ? 'Сүүлийн дүн' : '';
    const hd = h('div', { class: 'lc-h' }, sitePlate(st, 'sm'), h('b', {}, STATION_LABEL[st]),
      tag ? h('span', { class: `lc-tag${current ? ' live' : ''}` }, current ? h('i', { class: 'lc-dot' }) : null, tag) : null);
    if (!m) return h('div', { class: 'lc' }, hd, h('div', { class: 'lc-empty' }, 'Энэ станцад тоглолт байхгүй'));
    const { A, B, joined } = pairText(state, m);
    const done = isDone(m);
    const win = done ? winnerSide(m) : null;
    const nextLine = current && next ? (() => {
      const p = pairText(state, next);
      return h('div', { class: 'lc-next' }, h('b', {}, `Дараа ${fmtTime(next.start)}`), h('span', {}, p.joined || `${p.A.text} – ${p.B.text}`));
    })() : null;
    const card = h('div', { class: `lc${current ? ' is-live' : ''}${done ? ' is-done' : ''}${m.stage === 'final' ? ' final' : ''}` }, hd,
      h('div', { class: 'lc-stage' }, `${stageText(m)} · ${fmtTime(m.start)}–${fmtTime(m.end)}`),
      h('div', { class: 'lc-mu' },
        joined
          ? h('div', { class: 'lc-team ph' }, joined)
          : [h('div', { class: `lc-team${A.known ? '' : ' ph'}${win === 'a' ? ' win' : ''}` }, A.text),
            h('div', { class: 'lc-vs' }, done ? (scoreText(m) || 'VS') : 'VS'),
            h('div', { class: `lc-team${B.known ? '' : ' ph'}${win === 'b' ? ' win' : ''}` }, B.text)]),
      nextLine);
    if (m.grp) vars(card, { '--gc': GROUP_COLOR[m.grp] });
    return card;
  }

  function standingsBox(g, drawn) {
    const st = drawn ? groupStandings(publicView(state), g, { official: false }) : null;
    let rows;
    if (st && Array.isArray(st.rows) && st.rows.length) {
      rows = st.rows.slice().sort((a, b) => ((a.rank ?? 9) - (b.rank ?? 9)) || (a.seat - b.seat)).map((r) => ({
        rank: r.rank, name: classUp(teamLabel(state, r.teamId)) || '—', p: r.p, rd: r.rd, pts: r.pts,
        q: st.status === 'complete' && r.rank != null && r.rank <= 2,
      }));
    } else {
      const codes = drawn && state.draw.groups && Array.isArray(state.draw.groups[g]) ? state.draw.groups[g] : [];
      rows = [1, 2, 3].map((s) => ({ rank: null, name: codes[s - 1] ? classUp(nameByCode(state, codes[s - 1])) : `${GROUP_LABEL[g]}${s}`, p: null, rd: null, pts: null }));
    }
    const status = st ? st.status : 'pending';
    const chip = status === 'complete' ? ['Дууссан', 'ok'] : status === 'provisional' ? ['Урьдчилсан', 'warn'] : status === 'needs_lot' ? ['Сугалаа хэрэгтэй', 'warn'] : null;
    const signed = (v) => (v == null ? '–' : v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0');
    return vars(h('div', { class: 'std' },
      h('div', { class: 'std-h' }, h('b', {}, `${GROUP_LABEL[g]} хэсэг`), h('span', {}, STATION_LABEL[GROUP_STATION[g]]),
        chip ? h('span', { class: `std-chip ${chip[1]}` }, chip[0]) : null),
      h('div', { class: 'std-r hd' }, h('span', {}, '#'), h('span', {}, 'Баг'), h('span', {}, 'Т'), h('span', {}, 'Р±'), h('span', {}, 'О')),
      rows.map((r) => h('div', { class: `std-r${r.q ? ' q' : ''}` },
        h('span', { class: 'std-rank' }, r.rank == null ? '–' : String(r.rank)),
        h('b', { class: 'std-n' }, r.name),
        h('span', {}, r.p == null ? '–' : String(r.p)),
        h('span', {}, signed(r.rd)),
        h('b', { class: 'std-pts' }, r.pts == null ? '–' : String(r.pts))))), { '--gc': GROUP_COLOR[g] });
  }

  function koBox(m, now, cls = '') {
    if (!m) return h('div', { class: 'bx' }, '—');
    const done = isDone(m);
    const live = isNow(m, now);
    const win = done ? winnerSide(m) : null;
    const row = (side) => {
      const s = sideInfo(state, m, side);
      const sc = side === 'a' ? m.score_a : m.score_b;
      return h('div', { class: `bx-r${win === side ? ' win' : win ? ' lost' : ''}` },
        h('span', { class: `bx-t${s.known ? '' : ' ph'}` }, classUp(s.text)),
        h('b', { class: 'bx-s' }, done && sc != null ? String(sc) : ''));
    };
    return h('div', { class: `bx${cls ? ` ${cls}` : ''}${live ? ' is-now' : ''}${done ? ' is-done' : ''}` },
      h('div', { class: 'bx-h' }, h('b', {}, stageText(m)), h('span', {}, `${fmtTime(m.start)} · ${m.station === 'A' ? 'А' : 'Б'} станц`),
        live ? h('span', { class: 'bx-live' }, 'Одоо') : null),
      row('a'), row('b'));
  }

  function tickerDefaults(p) {
    const s = settingsOf(state);
    const fb = `Шууд дамжуулалт: «${FB_PAGE}» Facebook хуудас`;
    const come = 'Тоглолтоос 15 минутын өмнө хүлээлгийн өрөөнд ирээрэй';
    switch (p) {
      case 'reg': return [
        `Онлайн бүртгэл ${dayTime(s.reg)} хүртэл. Ангиа бүртгүүлээрэй!`,
        `Хураамжаа нягтлан бодогчид, зөвшөөрлөө багшдаа ${dayTime(DATES.fee_due_at)} хүртэл өгөөрэй`,
        'Охид, хөвгүүд ангийнхаа нэг багт тоглоно',
        `Шагналын сан ${money(PRIZES.fund)} + MVP ${money(PRIZES.mvp_cash)}`,
        `Steam QR дадлага 10.19–23. Утсандаа Steam${NBSP}Mobile апп суулгаарай`,
        `Тэмцээнийг «${FB_PAGE}» Facebook хуудсаар, танхимын проектороор шууд үзнэ`,
        'Skin, item, бооцоо байхгүй',
      ];
      case 'closed': return ['Тоглогчид 10.24 (Бя) 08:30-д ирж бүртгүүлнэ. Нээлт 09:00-д', come, fb, 'Үзэгчид танхимаас үзнэ. Лабораторид орохгүй'];
      case 'day1': return [come, 'Тоглолтын үеэр утсаа шүүгчид хадгалуулна', fb, `Хуваарь, оноо: ${SITE_SHORT}`];
      case 'night': return ['10.25 (Ня) 09:30-д шөвгийн 8 эхэлнэ', come, fb, `Хуваарь, оноо: ${SITE_SHORT}`];
      case 'day2': return ['Финал, 3-р байрын тоглолт 14:45-д. Шагнал гардуулах ёслол 16:15-д', come, fb, `Хуваарь, оноо: ${SITE_SHORT}`];
      default: return [`Баярлалаа! Дүн: ${SITE_SHORT}`, 'Шилжин явах «Сургуулийн аварга» цом аварга ангид'];
    }
  }

  const qrCaption = (p) => (p === 'reg' ? 'Дүрэм, маягт, хуваарь'
    : p === 'closed' ? 'Хэсэг, хуваарь, дүрэм'
      : p === 'over' ? 'Дүн, хасагдах шат' : 'Хуваарь, оноо шууд');

  const SLIDES = {
    hero: () => slideEl('hero',
      h('div', { class: 'hero-grid' },
        h('div', { class: 'hero-copy' },
          kick('8–12-р анги · 10.24–25'),
          h('h2', { class: 'scr-h hero-h' }, h('span', {}, 'Ангиа'), ' ', h('em', {}, 'аварга болго!')),
          h('p', { class: 'scr-lead' },
            h('span', { class: 'ln' }, `Анги бүрээс 1 баг: 5 тоглогч + 1${NBSP}нөөц.`), ' ',
            h('span', { class: 'ln' }, 'Охид ангийнхаа багт тоглоно.'))),
        h('div', { class: 'hero-art' }, h('i', { class: 'hero-rays deco' }), bigTrophy())),
      h('div', { class: 'statrow' },
        stat('12', 'баг'), stat('20', 'тоглолт'), stat('1', 'цом'), stat(money(PRIZES.fund), 'шагналын сан', 'gold'))),

    race: () => {
      const r = regSummary(state);
      const rows = r.teams.map(raceRow);
      const half = Math.ceil(rows.length / 2);
      return slideEl('race',
        title('Ангиудын уралдаан'),
        h('div', { class: 'race-grid' }, h('div', { class: 'race-col' }, rows.slice(0, half)), h('div', { class: 'race-col' }, rows.slice(half))),
        r.players
          ? h('div', { class: 'race-sum' },
            h('b', {}, `${r.confirmed}/${r.total || 12}`), h('span', {}, ' баг баталгаажсан'), h('i', {}, '·'),
            h('b', {}, `${r.players}/${r.maxPlayers || 72}`), h('span', {}, ' тоглогч'))
          : h('div', { class: 'race-sum cta' }, h('b', {}, 'Аль анги түрүүлж бүртгүүлэх вэ?')));
    },

    prize: () => slideEl('prize',
      h('div', { class: 'prize-top' },
        h('div', { class: 'prize-fund-w' }, kick('Шагналын сан'),
          h('div', { class: 'prize-fund' }, num(PRIZES.fund), h('span', { class: 'cur' }, '₮'))),
        h('div', { class: 'prize-mvp' }, icon('star'),
          h('div', {}, h('b', {}, 'MVP'), h('span', {}, 'жижиг цом + ', money(PRIZES.mvp_cash))))),
      h('div', { class: 'podium' }, placeCard(2), placeCard(1), placeCard(3)),
      h('p', { class: 'prize-note' }, icon('medal'), 'Медаль, өргөмжлөлтэй. Шагналыг зөвхөн ангийн баг авна.')),

    join: () => slideEl('join',
      title('Яаж оролцох вэ?'),
      h('div', { class: 'join-steps' }, [
        'Анги удирдсан багшаасаа ангийн QR кодоо аваарай.',
        '6 тоглогчоо бүртгээрэй.',
        'Багш PIN кодоор баталгаажуулна.',
        `${dayTime(DATES.fee_due_at)} хүртэл: эцэг эхийн зөвшөөрлөө багшдаа өгч, хураамжаа нягтлан бодогчид төлөөрэй.`,
      ].map((t, i) => h('div', { class: 'join-step' }, h('b', { class: 'join-n' }, pad2(i + 1)), h('span', {}, t))))),

    fee: () => slideEl('fee',
      kick('Тэмцээний хураамж'),
      h('div', { class: 'fee-big' }, h('b', {}, money(FEE.team)), h('span', {}, '/ анги')),
      h('div', { class: 'fee-per' }, `Тоглогч бүрд ойролцоогоор ${money(FEE.per_player)}`),
      h('div', { class: 'fee-cards' },
        h('div', { class: 'fcard' }, icon('doc'),
          h('p', {}, 'Нягтлан бодогчид төлж, баримт авна. Төлөөгүй баг тоглохгүй.'),
          h('div', { class: 'fee-due' }, icon('clock'), `${dayTime(DATES.fee_due_at)} хүртэл`)),
        h('div', { class: 'fcard' }, icon('trophy'),
          h('p', {}, 'Бүх хураамж шагналд зарцуулагдана. Багш нарын баг хураамж төлөхгүй.')))),

    req: () => slideEl('req',
      title('Бэлэн үү?'),
      h('div', { class: 'req-grid' },
        [[h('b', { class: 'req-age' }, '13+'), '13 нас хүрсэн'],
          [icon('users'), 'Өөрийн Steam бүртгэл'],
          [icon('phone'), `Утсандаа Steam${NBSP}Mobile апп`],
          [icon('doc'), 'Эцэг эхийн зөвшөөрөл']].map(([ico, text]) => h('div', { class: 'req' },
          h('div', { class: 'req-ico' }, ico), h('span', {}, text), h('i', { class: 'req-ok' }, icon('check'))))),
      h('div', { class: 'req-drill' }, icon('calendar'), h('b', {}, 'Steam QR дадлага'), h('span', {}, '10.19–23'))),

    teachers: () => slideEl('teachers',
      title('Багш нарыг ялж чадах уу?'),
      h('div', { class: 'vs' },
        h('div', { class: 'vs-side ct' }, icon('users'), h('b', {}, 'Танай анги')),
        h('b', { class: 'vs-x' }, 'VS'),
        h('div', { class: 'vs-side tt' }, icon('users'), h('b', {}, 'Багш нарын баг'))),
      h('p', { class: 'scr-lead tc-lead' }, 'Багш нарын баг бүх шатанд тоглоно. ', h('em', {}, 'Цом, медаль, мөнгөн шагналыг зөвхөн ангийн баг авна.'))),

    format: () => slideEl('format',
      title(['12 баг. ', h('em', {}, '1 цом.')], 'scr-h-xl'),
      h('div', { class: 'fmt-mid' }, sitePlate('A'), sitePlate('B'),
        h('div', { class: 'fmt-cap' }, h('b', {}, 'Нэг дор ', h('em', {}, '2 тоглолт')), h('span', {}, `${STATION_LABEL.A} · ${STATION_LABEL.B}`))),
      h('div', { class: 'tl' }, [
        ['10.24 (Бя)', '09:45–16:45', 'Хэсгийн шат'],
        ['10.25 (Ня)', '09:30', 'Шөвгийн 8'],
        ['10.25 (Ня)', '14:45', 'Финал'],
        ['10.25 (Ня)', '16:15', 'Шагнал'],
      ].map(([d, t, l], i) => h('div', { class: `tl-i${i === 2 ? ' gold' : ''}` },
        h('span', { class: 'tl-d' }, d), h('b', { class: 'tl-t' }, t), h('span', { class: 'tl-l' }, l))))),

    groups: () => {
      const drawn = drawShown(state);
      return slideEl('groups',
        h('div', { class: 'grp-top' }, title(drawn ? 'Хэсгүүд тодорлоо' : 'Хэсгүүд'),
          drawn ? null : h('div', { class: 'grp-note' }, `Сугалаа ${dayTime(DRAW_AT)}`)),
        h('div', { class: 'grp-grid' }, GROUPS.map((g) => groupBox(g, drawn))));
    },

    dates: () => {
      const now = clock.now();
      const s = settingsOf(state);
      const items = [
        { at: DRAW_AT, when: dayTime(DRAW_AT), label: 'Хэсгийн сугалаа' },
        { at: DATES.fee_due_at, when: dayTime(DATES.fee_due_at), label: 'Хураамж, зөвшөөрөл' },
        { at: s.reg, when: dayTime(s.reg), label: 'Онлайн бүртгэл хаагдана' },
        { at: TIMES.day1Start, when: '10.24–25 (Бя–Ня)', label: 'Тэмцээн' },
      ];
      const nextI = items.findIndex((it) => tms(it.at) > now);
      return slideEl('dates',
        title('Гол хугацаа'),
        h('div', { class: 'dl' }, items.map((it, i) => {
          const past = tms(it.at) <= now;
          return h('div', { class: `dl-i${past ? ' past' : ''}${i === nextI ? ' next' : ''}` },
            h('b', { class: 'dl-w' }, it.when),
            h('span', { class: 'dl-l' }, it.label),
            past ? h('span', { class: 'dl-tag past' }, 'Өнгөрсөн')
              : i === nextI ? h('span', { class: 'dl-tag' }, 'Дараагийнх') : null);
        })));
    },

    kickoff: () => {
      const info = DAY_INFO.d1 || [];
      const at = (hhmm) => (info.find((x) => x[0] === hhmm) || [hhmm, ''])[1];
      const firstMatch = fmtTime(wavesOf(1)[0] ? wavesOf(1)[0].start : MATCHES[0].start);
      return slideEl('kickoff',
        kick(`${fmtDate(TIMES.day1Start)} · ${SCHOOL}`),
        title('Цомын төлөө 12 баг', 'scr-h-xl'),
        h('div', { class: 'ko3' }, [['08:30', at('08:30') || 'Бүртгэл'], ['09:00', at('09:00') || 'Нээлт'], [firstMatch, 'Эхний тоглолт']]
          .map(([t, l], i) => h('div', { class: `ko3-i${i === 2 ? ' gold' : ''}` }, h('b', {}, t), h('span', {}, l)))),
        h('div', { class: 'ko-art' }, h('i', { class: 'hero-rays deco' }), bigTrophy()));
    },

    day1: () => daySlide(1),
    day2: () => daySlide(2),

    rules: () => slideEl('rules',
      title('Тоглолтын дүрэм'),
      h('div', { class: 'rules' },
        h('div', { class: 'rule' }, h('div', { class: 'rule-k' }, icon('clock'), h('b', {}, '15 мин')),
          h('p', {}, 'Тоглолтоос 15 минутын өмнө хүлээлгийн өрөөнд ирнэ.')),
        h('div', { class: 'rule hot' }, h('div', { class: 'rule-k' }, icon('hourglass'), h('b', {}, '13:0')),
          h('p', {}, '10 минутаас илүү хоцорвол техникийн ялагдал 13:0.')),
        h('div', { class: 'rule no' }, h('div', { class: 'rule-k' }, icon('ban')),
          h('p', {}, 'Skin, item, бооцоо байхгүй.')))),

    watch: () => slideEl('watch',
      title('Шууд үзээрэй'),
      h('div', { class: 'watch' },
        h('div', { class: 'wcard' }, icon('broadcast'), h('b', {}, 'Facebook хуудас'), h('span', {}, `«${FB_PAGE}»`)),
        h('div', { class: 'wcard' }, icon('monitor'), h('b', {}, 'Танхимын проектор'), h('span', {}, 'Тоглолтыг том дэлгэцээр'))),
      h('div', { class: 'watch-note' }, icon('ban'), 'Үзэгчид лабораторид орохгүй.')),

    live: () => {
      const now = clock.now();
      const rows = mergedMatches(state);
      const anyNow = ['A', 'B'].some((st) => stationNowNext(rows, st, now).current);
      return slideEl('live',
        title(anyNow ? 'Одоо тоглож байна' : 'Дараагийн тоглолт'),
        h('div', { class: 'live-grid' }, ['A', 'B'].map((st) => liveCard(st, rows, now))));
    },

    standings: () => {
      const drawn = drawShown(state);
      return slideEl('standings',
        title('Хэсгийн дүн'),
        h('div', { class: 'stds' }, GROUPS.map((g) => standingsBox(g, drawn))));
    },

    bracket: () => {
      const now = clock.now();
      const by = new Map(mergedMatches(state).map((m) => [m.no, m]));
      return slideEl('bracket',
        title('Хасагдах шат'),
        h('div', { class: 'brk' },
          h('div', { class: 'brk-col' }, h('div', { class: 'brk-cap' }, 'Шөвгийн 8'), [13, 15, 14, 16].map((n) => koBox(by.get(n), now))),
          h('div', { class: 'brk-col mid' }, h('div', { class: 'brk-cap' }, 'Шөвгийн 4'), [17, 18].map((n) => koBox(by.get(n), now))),
          h('div', { class: 'brk-col' }, h('div', { class: 'brk-cap gold' }, 'Финал'), koBox(by.get(19), now, 'final'),
            h('div', { class: 'brk-cap' }, '3-р байр'), koBox(by.get(20), now))));
    },

    champion: () => {
      const { places } = placesOf(state);
      const name = classUp(teamLabel(state, places[0]));
      const other = (i) => classUp(teamLabel(state, places[i])) || '?';
      return slideEl('champion',
        h('div', { class: 'champ' },
          h('div', { class: 'champ-art' }, h('i', { class: 'hero-rays deco' }), bigTrophy()),
          h('div', { class: 'champ-copy' },
            kick(CHAMPION_TITLE),
            h('div', { class: `champ-n${name ? '' : ' ph'}` }, name || '?'),
            h('div', { class: 'champ-rest' },
              h('span', {}, medalArt(2), h('b', {}, other(1))),
              h('span', {}, medalArt(3), h('b', {}, other(2)))))));
    },

    thanks: () => slideEl('thanks',
      h('div', { class: 'thx' },
        title('Баярлалаа!', 'scr-h-xl'),
        h('p', { class: 'scr-lead' }, 'Тоглогч, багш, шүүгч, үзэгч бүхэнд'),
        h('div', { class: 'thx-url' }, icon('star'), `Дүн: ${SITE_SHORT}`))),
  };

  function buildSlide(id) {
    try {
      const fn = SLIDES[id];
      return fn ? fn() : slideEl(id, title(SLIDE_LABEL[id] || id));
    } catch (e) {
      console.warn(e);
      return slideEl(id, title(SLIDE_LABEL[id] || id));
    }
  }

  /** Слайдыг самбарт багтаана (өгөгдөл урт байвал л жижигрүүлнэ). */
  function fitSlide(sec) {
    if (!sec || !sec.isConnected) return;
    sec.classList.add('scr-measure');           // .deco давхаргыг хэмжилтээс хасна
    const availH = sec.clientHeight;
    const availW = sec.clientWidth;
    const needH = sec.scrollHeight;
    const needW = sec.scrollWidth;
    sec.classList.remove('scr-measure');
    // ≤ 12 px: глифийн илүүдэл, самбарын дотор зай (40–48 px) багтаана — жижигрүүлэхгүй.
    const k = Math.min(availH > 0 && needH > availH + 12 ? availH / needH : 1, availW > 0 && needW > availW + 12 ? availW / needW : 1);
    if (k < 1) {
      const kk = Math.max(0.6, k);
      vars(sec, { width: `${(100 / kk).toFixed(3)}%`, height: `${(100 / kk).toFixed(3)}%` });
      sec.style.transform = `scale(${kk.toFixed(4)})`;
      sec.dataset.fit = kk.toFixed(3);
    }
  }

  function countUp(sec) {
    cancelAnimationFrame(countRaf);
    if (opt.isStatic || reducedMotion()) return;
    const els = [...sec.querySelectorAll('.scr-num[data-count]')];
    if (!els.length) return;
    for (const el of els) el.style.minWidth = `${el.offsetWidth}px`;
    const t0 = performance.now();
    const D = 1400;
    const step = (t) => {
      if (disposed || !sec.isConnected) return;
      const k = Math.min(1, (t - t0) / D);
      const e = 1 - (1 - k) ** 3;
      for (const el of els) {
        const to = Number(el.dataset.count) || 0;
        el.textContent = fmtNum(k >= 1 ? to : Math.round((to * e) / 1000) * 1000);
      }
      if (k < 1) countRaf = requestAnimationFrame(step);
    };
    for (const el of els) el.textContent = '0';
    countRaf = requestAnimationFrame(step);
  }

  function renderTab() {
    // ?slide= (export): таб нь эргэлтийн жагсаалт дахь байрлалыг харуулна («03/08»), «01/01» биш.
    const at = opt.lock ? fullList.indexOf(curId) : -1;
    const [i0, n] = at >= 0 ? [at, fullList.length] : [idx, list.length];
    tabNum.textContent = `${pad2(i0 + 1)}/${pad2(n)}`;
    tabLabel.textContent = SLIDE_LABEL[curId] || curId || '';
    clear(dots);
    if (n > 1) for (let i = 0; i < n; i++) dots.appendChild(h('i', { class: i === i0 ? 'on' : i < i0 ? 'done' : '' }));
  }

  function restartTimer() {
    clear(timerBar);
    const rotating = !opt.isStatic && !opt.lock && list.length > 1;
    timerBar.classList.toggle('is-off', !rotating);
    timerBar.appendChild(h('i'));
  }

  function mountSlide(id, enter) {
    const sec = buildSlide(id);
    const wrap = h('div', { class: `scr-anim${enter && !opt.isStatic ? ' scr-enter' : ''}` }, sec);
    clear(slot);
    slot.appendChild(wrap);
    fitSlide(sec);
    return sec;
  }

  function show(i, { enter = true } = {}) {
    if (!list.length || disposed) return;
    idx = ((i % list.length) + list.length) % list.length;
    curId = list[idx];
    const sec = mountSlide(curId, enter);
    stage.dataset.slide = curId;
    renderTab();
    restartTimer();
    countUp(sec);
    scheduleNext();
    if (opt.isStatic && tickerItems.length) showTick();   // static: гүйдэг мөр слайдын байрлалаас хамаарна
    updateDebug();
  }

  function scheduleNext() {
    clearTimeout(T.rot);
    T.rot = null;
    if (opt.isStatic || opt.lock || list.length < 2) return;
    T.rot = setTimeout(() => {
      if (disposed) return;
      syncPhase();
      show(idx + 1);
    }, opt.rotate);
  }

  /** Үе шат / слайдын жагсаалтыг шинэчилнэ. Жагсаалт өөрчлөгдвөл true (idx = одоогийн слайдын шинэ байрлал, байхгүй бол -1). */
  function syncPhase() {
    const now = clock.now();
    const p = screenPhase(now, state);
    const full = slidesFor(now, state, { live: !opt.isStatic });
    if (p !== phase) {
      phase = p;
      docEl.dataset.phase = p;
      store.setInterval(p === 'day1' || p === 'day2' ? 10000 : 30000);
      qrCap.textContent = qrCaption(p);
      if (booted) refreshTicker();
    }
    const key = full.join(',');
    const fullChanged = key !== fullList.join(',');
    fullList = full;
    if (docEl.dataset.slides !== key) docEl.dataset.slides = key;
    const nextList = opt.lock ? [opt.lock] : full;
    if (nextList.join(',') === list.join(',')) {
      if (opt.lock && fullChanged && curId) renderTab();
      return false;
    }
    const at = curId ? nextList.indexOf(curId) : -1;
    list = nextList;
    idx = at;
    return true;
  }

  // ---------- баруун талын тоолуур ----------
  function waveList(nos) {
    const rows = mergedMatches(state);
    return h('div', { class: 'cd-wave' }, nos.map((no) => {
      const m = rows.find((x) => x.no === no);
      if (!m) return null;
      const p = pairText(state, m);
      return h('div', { class: 'cd-wm' }, sitePlate(m.station, 'xs'), h('span', {}, p.joined || `${p.A.text} – ${p.B.text}`));
    }));
  }

  function buildRailStatic(cd) {
    const p = cd.phase;
    const s = settingsOf(state);
    const now = clock.now();
    const d1 = wavesOf(1);
    const d2 = wavesOf(2);
    const span = (w) => (w.length ? `${fmtTime(w[0].start)}–${fmtTime(w[w.length - 1].end)}` : '');
    const spec = p === 'reg' ? { label: 'Онлайн бүртгэл хаагдана', at: s.reg, time: fmtTime(s.reg) }
      : p === 'closed' ? { label: 'Тэмцээн эхэлнэ', at: TIMES.day1Start, time: fmtTime(TIMES.day1Start) }
        : p === 'day1' ? { label: 'Хэсгийн шат', at: TIMES.day1Start, time: span(d1) }
          : p === 'night' || p === 'day2' ? { label: 'Шөвгийн 8 · Финал', at: TIMES.day2First, time: span(d2) }
            : null;
    if (!spec) {
      add(cdBox, h('div', { class: 'cd-label' }, cd.label), h('div', { class: 'cd-end' }, icon('trophy'), h('b', {}, '10.24–25')));
      return;
    }
    const range = spec.time.includes('–');
    add(cdBox,
      h('div', { class: 'cd-label' }, spec.label),
      h('div', { class: 'cd-date' }, h('b', {}, fmtDate(spec.at).slice(0, 5)),
        h('div', { class: 'cd-date-r' }, h('span', {}, weekday(spec.at)), range ? null : h('em', {}, spec.time))),
      range ? h('div', { class: 'cd-span' }, spec.time) : null,
      cd.sub ? h('div', { class: 'cd-sub' }, icon('clock'), h('span', {}, `${cd.sub.label}: `), h('b', {}, dayTime(cd.sub.at))) : null,
      p === 'reg' && now < tms(DRAW_AT) ? h('div', { class: 'cd-chip' }, `Хэсгийн сугалаа ${dayTime(DRAW_AT)}`) : null);
  }

  function buildRail(cd, days) {
    clear(cdBox);
    cdParts = null;
    cdBox.className = `scr-cd hud${cd.urgent ? ' is-urgent' : ''}${cd.mode === 'live' ? ' is-live' : ''}${opt.isStatic ? ' is-static' : ''}`;
    if (opt.isStatic) { buildRailStatic(cd); return; }
    if (cd.mode === 'countdown' && cd.target) {
      const units = days ? ['хоног', 'цаг', 'мин', 'сек'] : ['цаг', 'мин', 'сек'];
      const cells = units.map((u) => {
        const a = h('span', {}, '0');
        const b = h('span', {}, '0');
        return { el: h('div', { class: 'cd-cell' }, h('b', {}, a, b), h('small', {}, u)), a, b };
      });
      cdParts = { cells, target: tms(cd.target) };
      add(cdBox,
        h('div', { class: 'cd-label' }, cd.label),
        h('div', { class: `cd-cells n${cells.length}` }, cells.map((c) => c.el)),
        cd.sub ? h('div', { class: 'cd-sub' }, icon('clock'), h('span', {}, `${cd.sub.label}: `), h('b', {}, dayTime(cd.sub.at))) : null,
        // тоолуур хаагдах цагийг өөрийг нь харуулдаггүй тул бүртгэлийн яг цагийг нэмнэ (сугалааны өдөр chip-ийн оронд)
        cd.phase === 'reg' && !cd.chip
          ? h('div', { class: 'cd-sub' }, icon('calendar'), h('span', {}, 'Онлайн бүртгэл: '), h('b', {}, dayTime(cd.target))) : null,
        cd.matches ? waveList(cd.matches) : null,
        cd.chip ? h('div', { class: 'cd-chip' }, cd.chip) : null);
    } else if (cd.mode === 'live') {
      const bar = h('i');
      cdParts = { bar, start: tms(cd.start), end: tms(cd.target) };
      add(cdBox,
        h('div', { class: 'cd-label live' }, h('i', { class: 'cd-dot' }), cd.label),
        h('div', { class: 'cd-range' }, `${fmtTime(cd.start)}–${fmtTime(cd.target)}`),
        h('div', { class: 'cd-bar' }, bar),
        cd.matches ? waveList(cd.matches) : null);
    } else {
      // 2-р өдөр 16:15-аас: ёслол дөнгөж эхэлж байна («гардууллаа» биш), финал албан ёсоор батлагдвал 'over' болно.
      const awards = cd.phase === 'day2';
      add(cdBox, h('div', { class: 'cd-label' }, awards ? 'Шагнал гардуулах ёслол' : cd.label),
        h('div', { class: 'cd-end' }, icon('trophy'), h('b', {}, awards ? fmtTime(TIMES.awards) : '10.24–25')));
    }
  }

  function updateRail(now) {
    if (!cdParts) return;
    if (cdParts.cells) {
      const sec = Math.floor(Math.max(0, cdParts.target - now) / 1000);
      const vals = cdParts.cells.length === 4
        ? [Math.floor(sec / 86400), Math.floor((sec % 86400) / 3600), Math.floor((sec % 3600) / 60), sec % 60]
        : [Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), sec % 60];
      cdParts.cells.forEach((c, i) => {
        const t = pad2(Math.min(99, vals[i]));
        if (c.a.textContent !== t[0]) c.a.textContent = t[0];
        if (c.b.textContent !== t[1]) c.b.textContent = t[1];
      });
    }
    if (cdParts.bar) {
      const k = cdParts.end > cdParts.start ? Math.min(1, Math.max(0, (now - cdParts.start) / (cdParts.end - cdParts.start))) : 0;
      cdParts.bar.style.transform = `scaleX(${k.toFixed(4)})`;
    }
  }

  function renderRail() {
    const now = clock.now();
    const cd = countdownFor(now, state);
    const days = !!cd.target && tms(cd.target) - now >= 86400000;
    const key = [cd.phase, cd.mode, cd.label, cd.target, cd.start, cd.sub ? cd.sub.at : '', cd.chip || '', cd.urgent, days,
      (cd.matches || []).join('.'), state && state.version].join('|');
    if (key !== cdKey) { cdKey = key; buildRail(cd, days); }
    updateRail(now);
  }

  // ---------- гүйдэг мөр ----------
  /** Админы зарлал үндсэн мөрүүдтэй ээлжилнэ (зарлал гарсан ч хугацаа, хураамжийн мөр алга болохгүй). */
  function tickerList() {
    const ann = (state && Array.isArray(state.announcements) ? state.announcements : [])
      .filter((a) => a && typeof a.text === 'string' && a.text.trim())
      .map((a) => ({ text: a.text.trim(), kind: a.level === 'warn' ? 'warn' : 'ann' }));
    const defs = tickerDefaults(phase).map((text) => ({ text, kind: '' }));
    if (!ann.length) return defs;
    const out = [];
    for (let i = 0; i < Math.max(ann.length, defs.length); i++) {
      out.push(ann[i % ann.length]);
      if (i < defs.length) out.push(defs[i]);
    }
    return out;
  }

  function showTick() {
    clearTimeout(T.ticker);
    T.ticker = null;
    clear(tickBox);
    if (!tickerItems.length) return;
    // static (export): слайд бүр өөр мөр харуулна — USB-ийн зураг/видеонд бүх мөр багтана
    const at = opt.isStatic ? Math.max(0, fullList.indexOf(curId)) : tickerI;
    const it = tickerItems[at % tickerItems.length];
    const txt = h('span', { class: 'tick-t' }, it.text);
    const viewport = h('span', { class: 'tick-v' }, txt);
    const row = h('div', { class: `tick-i${it.kind ? ` ${it.kind}` : ''}${opt.isStatic ? '' : ' tick-in'}` },
      it.kind ? h('b', { class: 'tick-k' }, 'Зарлал') : h('b', { class: 'tick-k ico' }, icon('star')), viewport);
    tickBox.appendChild(row);
    const over = viewport.scrollWidth - viewport.clientWidth;
    const marquee = over > 4 && !opt.isStatic && !reducedMotion();
    if (over > 4 && !marquee) {
      // Гүйлгэхгүй үед (static export, багасгасан хөдөлгөөн) урт зарлалыг 2 мөрөөр бүтнээр нь; багтахгүй бол «…».
      row.classList.add('is-2l');
      const lh = parseFloat(getComputedStyle(viewport).lineHeight) || 32;
      if (viewport.clientHeight > 2 * lh + 2 || viewport.clientHeight > tickBox.clientHeight) row.classList.remove('is-2l');
    }
    if (opt.isStatic) return;
    let dur = TICKER_MS;
    if (marquee) {
      const scrollMs = Math.round((over / 110) * 1000);
      vars(txt, { '--dx': `${-over}px`, '--md': `${scrollMs}ms` });
      txt.classList.add('is-marq');
      dur = Math.max(TICKER_MS, 1500 + scrollMs + 2000);
    }
    if (tickerItems.length > 1 || marquee) T.ticker = setTimeout(() => { tickerI += 1; showTick(); }, dur);
  }

  function refreshTicker() {
    const items = tickerList();
    const key = JSON.stringify(items);
    if (key === tickerKey) return;
    tickerKey = key;
    tickerItems = items;
    tickerI = 0;
    showTick();
  }

  // ---------- нэг секундын цикл ----------
  function tick() {
    if (disposed) return;
    if (syncPhase()) {
      if (idx < 0) show(0, { enter: !opt.isStatic });
      else renderTab();
    }
    renderRail();
    updateDebug();
    if (!opt.isStatic) T.tick = setTimeout(tick, 1000 - (Date.now() % 1000) + 15);
  }

  // ---------- өгөгдөл ----------
  const onState = (s, meta) => {
    if (s) {
      if (armed && s !== lastSeen && !(meta && meta.error)) clock.observe(s);
      lastSeen = s;
      state = s;
    } else if (!state && meta && meta.error) {
      state = fallbackState();
    }
    if ((s || (meta && meta.error)) && stateWaiter) { const w = stateWaiter; stateWaiter = null; w(); }
    if (!booted || disposed || !state) return;
    const changed = syncPhase();
    if (changed && idx < 0) show(0, { enter: false });
    else {
      if (DATA_SLIDES.has(curId)) mountSlide(curId, false);
      if (changed || DATA_SLIDES.has(curId)) renderTab();   // жагсаалт өөрчлөгдвөл таб «03/10» шинэчлэгдэнэ
    }
    refreshTicker();
    renderRail();
  };
  const unsub = store.subscribe(onState);
  armed = true;

  const stateReady = () => (state ? Promise.resolve() : new Promise((res) => {
    const t = setTimeout(res, STATE_WAIT_MS);
    stateWaiter = () => { clearTimeout(t); res(); };
  }));
  const fontsReady = () => (document.fonts && document.fonts.load
    ? withTimeout(Promise.all([
      document.fonts.load('700 100px Oswald', 'ӨҮ₮'),
      document.fonts.load('400 40px Oswald', 'ӨҮ₮'),
    ]).then(() => document.fonts.ready).catch(() => {}), 8000)
    : Promise.resolve());
  const logoReady = () => (logo.decode ? withTimeout(logo.decode().catch(() => {}), 5000) : Promise.resolve());
  const qrReady = () => withTimeout(loadQr().then((qrcode) => {
    if (disposed) return;
    clear(qrBox);
    qrBox.appendChild(qrNode(qrcode, SITE_URL, 'scr-qr'));
  }).catch(() => {
    clear(qrBox);
    qrBox.appendChild(h('div', { class: 'scr-qr-fb' }, SITE_SHORT));
  }), 8000);

  // ---------- киоск: дэлгэц унтрахгүй, курсор нуугдана ----------
  const lock = async () => {
    try {
      if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
      const w = await navigator.wakeLock.request('screen');
      if (disposed) w.release(); else wake = w;
    } catch { wake = null; }
  };
  const onVis = () => { if (document.visibilityState === 'visible') lock(); };
  const onMove = () => {
    document.body.classList.remove('pub-idle');
    clearTimeout(idleT);
    idleT = setTimeout(() => document.body.classList.add('pub-idle'), 3000);
  };
  const onResize = () => layout();
  document.addEventListener('visibilitychange', onVis);
  document.addEventListener('mousemove', onMove);
  window.addEventListener('resize', onResize);
  lock();
  onMove();
  layout();

  /** Шинэ хувилбар гарвал (config.js BUILD) хуудсыг дахин ачаална. */
  async function checkBuild() {
    try {
      const res = await fetch(`js/config.js?b=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok || disposed) return;
      const m = /BUILD\s*=\s*['"]([^'"]+)['"]/.exec(await res.text());
      if (!m || m[1] === BUILD) return;
      let prev = null;
      try { prev = JSON.parse(sessionStorage.getItem('scr-reload') || 'null'); } catch { prev = null; }
      if (prev && prev.b === m[1] && Date.now() - prev.at < 30 * 60 * 1000) return;   // HTML кэш хуучин байж болно
      try { sessionStorage.setItem('scr-reload', JSON.stringify({ b: m[1], at: Date.now() })); } catch { /* ignore */ }
      location.reload();
    } catch { /* сүлжээгүй */ }
  }
  if (!opt.isStatic) {
    T.nudge = setInterval(() => { nudgeI += 1; layout(); }, NUDGE_MS);
    T.build = setInterval(checkBuild, BUILD_CHECK_MS);
  }

  // ---------- эхлүүлэх ----------
  (async () => {
    await Promise.all([fontsReady(), logoReady(), qrReady(), stateReady()]);
    if (disposed) return;
    if (!state) state = fallbackState();
    booted = true;
    syncPhase();
    show(0, { enter: false });
    refreshTicker();
    tick();
    await raf2();
    if (!disposed) docEl.dataset.screenReady = '1';
  })();

  return () => {
    disposed = true;
    unsub();
    if (stateWaiter) { const w = stateWaiter; stateWaiter = null; w(); }   // ачаалал дундаа гарвал хүлээлтийн таймерыг цэвэрлэнэ
    clearTimeout(T.rot); clearTimeout(T.tick); clearTimeout(T.ticker); clearTimeout(idleT);
    clearInterval(T.nudge); clearInterval(T.build);
    cancelAnimationFrame(countRaf);
    document.removeEventListener('visibilitychange', onVis);
    document.removeEventListener('mousemove', onMove);
    window.removeEventListener('resize', onResize);
    try { if (wake) wake.release(); } catch { /* ignore */ }
    view.remove();
    link.remove();
    restoreDoc();
    document.body.classList.remove('pub-idle', 'scr-mode');
    store.setInterval(20000);
  };
}
