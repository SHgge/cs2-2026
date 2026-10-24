// ТВ / Урлагийн заалын LED дэлгэц: цаг, станц бүрийн ОДОО ба ДАРАА тоглолт, дараагийн ээлжийн дуудлага (Windows lab-ын үүдэнд),
// 20 секунд тутам «Хэсгийн байр» ↔ «Хасагдах шат» (?panel=groups|bracket|veto — нэгийг нь тогтмол харуулна).
// Газрын зургийн хасалт (удирдамж 02 §7.9): станц бүрийн одоогийн/дараагийн тоглолтын самбар «Газрын зургийн хасалт»
// эргэлтэд нэмэгдэнэ; хасалт явагдаж байхад тэр самбар дээр тогтоно, дуусахад шийдэгдсэн газрын зураг нэг ээлж (20 с) үлдэнэ.
// Финал, 3-р байр Bo3 (14-р migration): хасах, хасах, сонгох, сонгох, хасах, хасах → шийдвэрлэх; цувралын оноо (газрын тоо),
// одоогийн газар («2-р газар · Nuke») ба газар бүрийн оноо.
// Шинэ хувилбар гарвал (config.js BUILD, 10 минут тутам) хуудсыг өөрөө дахин ачаална (#/screen-тэй адил; ?overlay=1-д биш).
// ?overlay=1 — OBS-д зориулсан ил тод доод мөр (?overlay=1&station=A — зөвхөн нэг станц). Зөвхөн ангийн нэр харуулна.
import { h, clear, fmtTime, fmtDate } from '../ui.js';
import { store } from '../store.js';
import { BUILD, SCHOOL, FB_PAGE, PLACES } from '../config.js';
import { GROUPS, STATION_LABEL, EVENT_NAME, CUP_NAME } from '../event.js';
import {
  makeClock, mergedMatches, stationNowNext, nextWave, sideInfo, scoreText, isDone, statusOf, stageTag,
  fallbackState, ubDay, fmtDateShort, winnerSide, vetoInfo, mapName, seriesInfo, seriesText, liveSeriesScore,
} from './schedule.js';
import { groupCard } from './groups.js';
import { bracketTree } from './bracket.js';

const ROTATE_MS = 20000;
const STALE_MS = 60000;
const MIN = 60 * 1000;
/** Хасалт эхлээгүй дараагийн тоглолтын самбар: эхлэхээс 30 минутын өмнөөс. */
const VETO_LEAD_MS = 30 * MIN;
/** Эхлэх цагаас хойш 20 минут өнгөрсөн 'live' тоглолтын эхлээгүй хасалт = шүүгч апп-аар хийгээгүй → самбаргүй. */
const VETO_SKIP_MS = 20 * MIN;
/** Хасалт дуусаагүй ч эхлэх цагаас 30 минут өнгөрвөл хасалтын самбар дээр тогтохоо болино (эргэлтэд үлдэнэ). */
const VETO_PIN_MS = 30 * MIN;
/** Шинэ хувилбар (config.js BUILD) шалгах давтамж — #/screen-тэй адил. */
const BUILD_CHECK_MS = 10 * MIN;
const PCS = { A: 'PC 01–10', B: 'PC 11–20' };
const iso = (ms) => new Date(ms).toISOString();

export default async function render(root, params = {}) {
  const q = (params && params.query) || {};
  const overlay = q.overlay === '1';
  const st = String(q.station || '').toUpperCase();
  const only = st === 'A' || st === 'B' ? st : null;
  const stations = only ? [only] : ['A', 'B'];
  const PANELS = ['groups', 'bracket'];
  const fixedPanel = [...PANELS, 'veto'].includes(q.panel) ? q.panel : null;
  const clock = makeClock();
  store.setInterval(5000);
  document.body.classList.add(overlay ? 'tv-overlay' : 'tv-mode');

  let cur = null;
  let offline = false;
  let lastSeen = null;
  let armed = false;
  let panel = 0;
  let shownPanel = null;
  let wasPinned = false;
  let holdUntil = 0;
  let disposed = false;

  // ---------- бүтэц ----------
  const clockMain = h('b', {}, '');
  const clockSec = h('span', { class: 'tv-sec' }, '');
  const clockDate = h('small', {}, '');
  const stale = h('div', { class: 'tv-stale', role: 'status', hidden: true }, '');
  const stationsBox = h('section', { class: `tv-stations${only ? ' one' : ''}`, 'aria-label': 'Станцууд' });
  const call = h('div', { class: 'tv-call', role: 'status' });
  const rotTitle = h('h2', {}, '');
  const rotDots = h('span', { class: 'tv-dots', 'aria-hidden': 'true' });
  const rotBody = h('div', { class: 'tv-rot-body' });
  const ticker = h('footer', { class: 'tv-ticker' });
  const ovBox = h('div', { class: 'ov', 'aria-live': 'off' });

  clear(root);
  if (overlay) {
    root.appendChild(ovBox);
  } else {
    root.appendChild(h('div', { class: 'tv' },
      h('header', { class: 'tv-top' },
        h('div', { class: 'tv-brand' },
          h('img', { class: 'tv-logo', src: 'assets/img/logo-192.png', alt: '', width: '56', height: '56' }),
          h('div', {}, h('b', {}, EVENT_NAME.replace(' 2026', '\u00A02026')), h('span', {}, SCHOOL))),
        h('div', { class: 'tv-clock', 'aria-label': 'Цаг' }, h('div', {}, clockMain, clockSec), clockDate)),
      stale, stationsBox, call,
      h('section', { class: 'tv-rot' }, h('div', { class: 'tv-rot-h' }, rotTitle, rotDots), rotBody),
      ticker));
  }

  // ---------- хэсгүүд ----------
  function teamsLine(m, cls = 'tv-match') {
    const A = sideInfo(cur, m, 'a');
    const B = sideInfo(cur, m, 'b');
    const done = isDone(m);
    const win = done ? winnerSide(m) : null;
    const sc = done ? scoreText(m) : liveSeriesScore(m, seriesInfo(cur, m));   // Bo3: явагдаж буй цувралын оноо
    const long = (t) => (t.length > 8 ? ' long' : '');
    return h('div', { class: cls },
      h('span', { class: `tv-team${A.known ? '' : ' ph'}${win === 'a' ? ' win' : ''}${long(A.text)}` }, A.text),
      h('span', { class: sc ? `tv-sc${done ? '' : ' live'}` : 'tv-vs' }, sc || 'VS'),
      h('span', { class: `tv-team r${B.known ? '' : ' ph'}${win === 'b' ? ' win' : ''}${long(B.text)}` }, B.text));
  }

  function stationCard(station, rows, now) {
    const { current, next, last } = stationNowNext(rows, station, now);
    const main = current || last;
    const tag = current ? 'ОДОО' : last ? 'СҮҮЛИЙН ДҮН' : null;
    const grpCls = main && main.grp ? ` gc-${main.grp}` : main ? ` ko-${main.stage}` : '';
    return h('article', { class: `tv-st${current ? ' is-live' : ''}${grpCls}` },
      h('header', {}, h('b', {}, STATION_LABEL[station] || station), h('span', {}, PCS[station])),
      main
        ? h('div', { class: 'tv-now' },
          h('div', { class: 'tv-tags' }, h('span', { class: `tv-tag${current ? ' live' : ''}` }, tag), stageTag(main),
            !current && statusOf(main).text ? h('span', { class: 'tv-stx' }, statusOf(main).text) : null),
          teamsLine(main),
          h('div', { class: 'tv-meta' }, `${fmtTime(main.start)}–${fmtTime(main.end)}`, mapChip(main)))
        : h('div', { class: 'tv-now empty' }, h('p', {}, 'Одоогоор тоглолт алга')),
      next
        ? h('div', { class: 'tv-next' },
          h('span', { class: 'tv-tag' }, 'ДАРАА'),
          h('b', { class: 'tv-ntime' }, ubDay(Date.parse(next.start)) === ubDay(now) ? fmtTime(next.start) : `${fmtDateShort(next.start)} ${fmtTime(next.start)}`),
          stageTag(next),
          teamsLine(next, 'tv-nmatch'),
          mapChip(next))
        : null);
  }

  // ---------- газрын зургийн хасалт (удирдамж 02 §7.9) ----------
  /**
   * Мөрөнд: шийдэгдсэн газрын зураг, эсвэл «Газрын зургийн хасалт 3/6». Хасалт эхлээгүй / өгөгдөлгүй бол юу ч үгүй.
   * Bo3: «Газрын зургийн хасалт, сонголт 3/6»; дууссаны дараа тоглож буй/дараагийн газар («2-р газар · Nuke») ба
   * тоглосон газрын оноо, цуврал шийдэгдвэл бүх газрын оноо.
   */
  function mapChip(m) {
    const v = vetoInfo(cur, m);
    if (!v || (!v.started && !v.map && !v.maps.length)) return null;
    if (v.bo === 3) {
      if (!v.done) return h('span', { class: 'tv-mapc prog' }, `Газрын зургийн хасалт, сонголт ${v.steps.length}/${v.total}`);
      const si = seriesInfo(cur, m);
      if (!si) return null;
      if (si.decided) return h('span', { class: 'tv-mapc ser' }, h('small', {}, 'Bo3'), seriesText(si));
      const played = { ...si, rows: si.rows.slice(0, si.played) };
      return [
        si.currentMap ? h('span', { class: 'tv-mapc' }, h('small', {}, `${si.current + 1}-р газар`), mapName(si.currentMap)) : null,
        si.played ? h('span', { class: 'tv-mapc ser' }, seriesText(played)) : null,
      ];
    }
    return v.map
      ? h('span', { class: 'tv-mapc' }, h('small', {}, 'Газрын зураг'), mapName(v.map))
      : h('span', { class: 'tv-mapc prog' }, `Газрын зургийн хасалт ${v.steps.length}/${v.total}`);
  }

  /**
   * Станцын хасалтын самбарт харуулах тоглолт: хасалт явагдаж буй → одоогийн → 30 минутын дотор эхлэх дараагийн.
   * null = самбаргүй (хуучин төлөв, эсвэл ойрын тоглолт алга). active = хасалт явагдаж байна → самбар дээр тогтоно.
   */
  function vetoFocus(rows, station, now) {
    const { current, next } = stationNowNext(rows, station, now);
    const list = [current, next].filter(Boolean).map((m) => ({ m, v: vetoInfo(cur, m), at: Date.parse(m.start) })).filter((x) => x.v);
    const going = (x) => x.v.started && !x.v.done;
    const show = (x) => x.v.started || x.v.done || (x.m === current
      ? !(x.m.status === 'live' && now - x.at > VETO_SKIP_MS)
      : !current && x.at - now <= VETO_LEAD_MS);
    const f = list.find(going) || list.find((x) => x.m === current && show(x)) || list.find((x) => x.m === next && show(x));
    return f ? { ...f, isNow: f.m === current, active: going(f) && !(now - f.at > VETO_PIN_MS) } : null;
  }

  /** Нэг станцын самбар: ээлж («8а хасна (3/6)») эсвэл «Тоглох газрын зураг», 7 хавтан — хассан нь зурсан + хассан баг. */
  function vetoBoard(station, f) {
    const head = h('header', { class: 'tv-vb-h' }, h('b', {}, STATION_LABEL[station] || station),
      f ? h('span', { class: `tv-tag${f.isNow ? ' live' : ''}` }, f.isNow ? 'ОДОО' : `ДАРАА ${fmtTime(f.m.start)}`) : null,
      f ? teamsLine(f.m, 'tv-nmatch') : null);
    if (!f) return h('article', { class: 'tv-vb empty' }, head, h('p', {}, 'Одоогоор хасалт алга'));
    const { m, v } = f;
    const team = (side) => sideInfo(cur, m, side).text;
    if (v.bo === 3) return bo3Board(head, m, v, team);
    let turn;
    if (v.done) turn = h('div', { class: 'tv-vb-st done' }, h('small', {}, 'Тоглох газрын зураг'), h('b', {}, mapName(v.map)));
    else if (!v.next) turn = h('div', { class: 'tv-vb-st' }, 'Зоос хаяж, эхэлж хасах багийг тодруулна');
    else if (!v.started && m.stage !== 'group') turn = h('div', { class: 'tv-vb-st' }, 'Зоосоор ', h('b', {}, team(v.next.side)), ' эхэлж хасна');
    else turn = h('div', { class: 'tv-vb-st' }, h('b', {}, team(v.next.side)), ` хасна (${v.steps.length}/${v.total})`);
    const by = new Map(v.steps.map((x) => [x.map, x.side]));
    return h('article', { class: `tv-vb${v.done ? ' is-done' : ''}${m.grp ? ` gc-${m.grp}` : ` ko-${m.stage}`}` }, head, turn,
      h('div', { class: 'tv-maps' }, v.pool.map((k) => {
        const side = by.get(k);
        const pick = v.map === k;
        const label = side ? team(side) : pick ? 'Тоглоно' : '';
        return h('div', { class: `tv-map${side ? ' ban' : pick ? ' pick' : ''}` },
          h('b', {}, mapName(k)),
          h('span', { class: label.length > 10 ? 'long' : null }, label || '\u00A0'));
      })));
  }

  /**
   * Bo3 самбар: ээлж «8а хасна (1/6)» / «8а сонгоно (3/6)», дууссаны дараа «Тоглох газрын зураг: Inferno · Nuke · Mirage».
   * Хавтан: хассан нь зурсан + баг, сонгосон нь «1 · 8а» / «2 · 10б», үлдсэн нь «3 · Шийдвэрлэх».
   */
  function bo3Board(head, m, v, team) {
    let turn;
    if (v.done) {
      turn = h('div', { class: 'tv-vb-st done' }, h('small', {}, 'Тоглох газрын зураг'),
        h('b', {}, v.maps.map((k) => mapName(k)).join(' · ')));
    } else if (!v.next) turn = h('div', { class: 'tv-vb-st' }, 'Зоос хаяж, эхэлж хасах багийг тодруулна');
    else if (!v.started) turn = h('div', { class: 'tv-vb-st' }, 'Зоосоор ', h('b', {}, team(v.next.side)), ' эхэлж хасна');
    else if (v.nextAct === 'pick') turn = h('div', { class: 'tv-vb-st' }, h('b', {}, team(v.next.side)), ` сонгоно (${v.steps.length}/${v.total})`);
    else turn = h('div', { class: 'tv-vb-st' }, h('b', {}, team(v.next.side)), ` хасна (${v.steps.length}/${v.total})`);
    const acts = Array.isArray(v.acts) ? v.acts : [];
    const tile = new Map();
    let n = 0;
    v.steps.forEach((x, i) => tile.set(x.map, acts[i] === 'pick' ? { cls: 'pick', label: `${++n} · ${team(x.side)}` } : { cls: 'ban', label: team(x.side) }));
    if (v.done && v.maps[2] && !tile.has(v.maps[2])) tile.set(v.maps[2], { cls: 'pick dec', label: '3 · Шийдвэрлэх' });
    return h('article', { class: `tv-vb bo3${v.done ? ' is-done' : ''} ko-${m.stage}` }, head, turn,
      h('div', { class: 'tv-maps' }, v.pool.map((k) => {
        const t = tile.get(k) || { cls: '', label: '' };
        return h('div', { class: `tv-map${t.cls ? ` ${t.cls}` : ''}` },
          h('b', {}, mapName(k)),
          h('span', { class: t.label.length > 10 ? 'long' : null }, t.label || '\u00A0'));
      })));
  }

  function callBox(rows, now) {
    clear(call);
    const w = nextWave(rows, now);
    if (!w) { call.hidden = true; return; }
    call.hidden = false;
    const sameDay = ubDay(w.start) === ubDay(now);
    const at = now >= w.callAt ? 'Одоо' : `${sameDay ? '' : `${fmtDateShort(iso(w.callAt))} `}${fmtTime(iso(w.callAt))}-д`;
    call.appendChild(h('b', { class: 'tv-call-t' }, `${at} ${PLACES.lab}-ын үүдэнд ирээрэй`));
    call.appendChild(h('span', { class: 'tv-call-m' }, w.matches.map((m) => {
      const A = sideInfo(cur, m, 'a'); const B = sideInfo(cur, m, 'b');
      return h('span', { class: `tv-call-p${m.grp ? ` gc-${m.grp}` : ''}` }, `${A.text} – ${B.text}`);
    })));
    call.appendChild(h('span', { class: 'tv-call-s' }, `Тоглолт ${fmtTime(iso(w.start))}-д эхэлнэ`));
  }

  /** Хасалтын самбар байгаа үед «Газрын зургийн хасалт» эргэлтэд нэмэгдэнэ; хасалт явагдаж байвал түүн дээр тогтоно. */
  function drawRot(now, rows) {
    const foci = stations.map((s) => [s, vetoFocus(rows, s, now)]);
    const list = fixedPanel === 'veto' || foci.some(([, f]) => f) ? [...PANELS, 'veto'] : PANELS;
    const pinned = foci.some(([, f]) => f && f.active);
    if (wasPinned && !pinned) holdUntil = now + ROTATE_MS;   // шийдэгдсэн газрын зургийг нэг ээлж (20 с) самбар дээр үлдээнэ
    wasPinned = pinned;
    const p = fixedPanel || (pinned || (now < holdUntil && list.includes('veto')) ? 'veto' : list[panel % list.length]);
    shownPanel = p;
    clear(rotBody);
    clear(rotDots);
    if (!fixedPanel) list.forEach((x) => rotDots.appendChild(h('i', { class: x === p ? 'on' : '' })));
    if (p === 'groups') {
      rotTitle.textContent = 'Хэсгийн байр';
      rotBody.appendChild(h('div', { class: 'tv-groups' }, GROUPS.map((g) => groupCard(cur, g, { compact: true, now, rows }))));
    } else if (p === 'bracket') {
      rotTitle.textContent = 'Хасагдах шат';
      rotBody.appendChild(bracketTree(cur, { compact: true, now, rows }));
    } else {
      rotTitle.textContent = 'Газрын зургийн хасалт';
      rotBody.appendChild(h('div', { class: `tv-vetos${foci.length === 1 ? ' one' : ''}` }, foci.map(([s, f]) => vetoBoard(s, f))));
    }
    requestAnimationFrame(fitRot);
  }

  /** Эргэлдэх хэсгийг үлдсэн зайд багтаана (дэлгэцийн хэмжээнээс үл хамааран). */
  function fitRot() {
    const inner = rotBody.firstElementChild;
    if (!inner || !rotBody.isConnected) return;
    inner.style.transform = '';
    const avail = rotBody.clientHeight;
    const need = inner.scrollHeight;
    const k = avail > 0 && need > avail ? Math.max(0.5, avail / need) : 1;
    inner.style.transformOrigin = 'top center';
    inner.style.transform = k < 1 ? `scale(${k.toFixed(3)})` : '';
  }

  function drawTicker() {
    clear(ticker);
    const ann = (cur && Array.isArray(cur.announcements) ? cur.announcements : []).filter((a) => a && a.text);
    const items = ann.length
      ? ann.map((a) => h('span', { class: `tv-ann${a.level === 'warn' ? ' warn' : ''}` }, a.text))
      : [h('span', {}, `Багууд ангидаа хүлээж, тоглолтоос 15 минутын өмнө ${PLACES.lab}-ын үүдэнд ирнэ`),
        h('span', {}, `Үзэгчид ${PLACES.lab}-д орохгүй`),
        h('span', {}, 'Тоглолтын үеэр утсаа шүүгчид хадгалуулна'),
        h('span', {}, `Шууд дамжуулалт: «${FB_PAGE}» Facebook хуудас`)];
    ticker.appendChild(h('div', { class: 'tv-tick' }, items));
  }

  function drawOverlay(now, rows, isStale) {
    clear(ovBox);
    ovBox.appendChild(h('div', { class: 'ov-brand' }, h('b', {}, 'CS2 2026'), h('span', {}, CUP_NAME)));
    if (!isStale) {
      for (const s of stations) {
        const { current, next } = stationNowNext(rows, s, now);
        const m = current || next;
        if (!m) continue;
        const A = sideInfo(cur, m, 'a'); const B = sideInfo(cur, m, 'b');
        const sc = isDone(m) ? scoreText(m) : liveSeriesScore(m, seriesInfo(cur, m));
        ovBox.appendChild(h('div', { class: `ov-m${m.grp ? ` gc-${m.grp}` : ` ko-${m.stage}`}` },
          h('span', { class: 'ov-st' }, (STATION_LABEL[s] || s).replace(' станц', '')),
          stageTag(m),
          current ? null : h('span', { class: 'ov-next' }, `${fmtTime(m.start)}`),
          h('b', { class: 'ov-t' }, A.text), h('span', { class: 'ov-sc' }, sc || '–'), h('b', { class: 'ov-t' }, B.text)));
      }
    }
    ovBox.appendChild(h('div', { class: 'ov-clock' }, fmtTime(iso(now))));
  }

  function staleState() {
    const s = store.status();
    if (offline) return { bad: true, at: s.lastOkAt };
    if (!s.lastOkAt) return { bad: !!s.error, at: 0 };
    return { bad: Date.now() - s.lastOkAt > STALE_MS, at: s.lastOkAt };
  }

  function drawAll(withRot) {
    if (!cur) return;
    const now = clock.now();
    const rows = mergedMatches(cur);
    const ss = staleState();
    if (overlay) { drawOverlay(now, rows, ss.bad && (!ss.at || Date.now() - ss.at > 2 * STALE_MS)); return; }
    clear(stationsBox);
    for (const s of stations) stationsBox.appendChild(stationCard(s, rows, now));
    callBox(rows, now);
    drawTicker();
    // хасалтын самбарыг 5 секунд тутам шинэчилнэ; хасалт эхэлмэгц тэр самбар руу шууд шилжинэ
    const pin = !fixedPanel && stations.some((s) => { const f = vetoFocus(rows, s, now); return !!(f && f.active); });
    if (withRot || shownPanel === 'veto' || pin) drawRot(now, rows);
  }

  function tickClock() {
    const now = clock.now();
    const t = new Date(now).toISOString();
    if (overlay) {
      const c = ovBox.querySelector('.ov-clock');
      if (c) c.textContent = fmtTime(t);
      return;
    }
    clockMain.textContent = fmtTime(t);
    clockSec.textContent = `:${String(new Date(now).getUTCSeconds()).padStart(2, '0')}`;
    clockDate.textContent = fmtDate(t);
    const ss = staleState();
    stale.hidden = !ss.bad;
    if (ss.bad) stale.textContent = `Мэдээлэл шинэчлэгдэхгүй байна${ss.at ? ` · сүүлд ${fmtTime(new Date(ss.at).toISOString())}` : ''}. Интернэтээ шалгана уу.`;
  }

  // ---------- өгөгдөл ----------
  const onState = (s, meta) => {
    if (s) {
      if (armed && s !== lastSeen && !(meta && meta.error)) clock.observe(s);
      lastSeen = s;
      cur = s; offline = false;
    } else if (!cur) {
      cur = fallbackState(); offline = true;
    }
    drawAll(true);
    tickClock();
  };
  const unsub = store.subscribe(onState);
  armed = true;
  if (!store.get()) onState(null, store.status());

  const onResize = () => requestAnimationFrame(fitRot);
  window.addEventListener('resize', onResize);
  const tClock = setInterval(tickClock, 1000);
  const tData = setInterval(() => drawAll(false), 5000);
  const tRot = setInterval(() => {
    if (fixedPanel || overlay || !cur) return;
    panel += 1;
    drawRot(clock.now(), mergedMatches(cur));
  }, ROTATE_MS);

  /** Шинэ хувилбар гарвал (config.js BUILD) хуудсыг дахин ачаална (screen.js-ийн checkBuild). OBS-ийн давхаргад биш. */
  async function checkBuild() {
    try {
      const res = await fetch(`js/config.js?b=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok || disposed) return;
      const m = /BUILD\s*=\s*['"]([^'"]+)['"]/.exec(await res.text());
      if (!m || m[1] === BUILD || disposed) return;
      let prev = null;
      try { prev = JSON.parse(sessionStorage.getItem('tv-reload') || 'null'); } catch { prev = null; }
      if (prev && prev.b === m[1] && Date.now() - prev.at < 30 * MIN) return;   // HTML кэш хуучин байж болно
      try { sessionStorage.setItem('tv-reload', JSON.stringify({ b: m[1], at: Date.now() })); } catch { /* ignore */ }
      location.reload();
    } catch { /* сүлжээгүй */ }
  }
  const tBuild = overlay ? null : setInterval(checkBuild, BUILD_CHECK_MS);

  // Дэлгэц унтрахаас сэргийлнэ (дэмждэг хөтөч дээр).
  let wake = null;
  const lock = async () => {
    try {
      if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
      const w = await navigator.wakeLock.request('screen');
      if (disposed) w.release(); else wake = w;
    } catch { wake = null; }
  };
  const onVis = () => { if (document.visibilityState === 'visible') lock(); };
  document.addEventListener('visibilitychange', onVis);
  lock();
  let idleT = null;
  const onMove = () => {
    document.body.classList.remove('pub-idle');
    clearTimeout(idleT);
    idleT = setTimeout(() => document.body.classList.add('pub-idle'), 3000);
  };
  document.addEventListener('mousemove', onMove);
  onMove();

  return () => {
    disposed = true;
    unsub();
    clearInterval(tClock); clearInterval(tData); clearInterval(tRot); clearInterval(tBuild); clearTimeout(idleT);
    document.removeEventListener('visibilitychange', onVis);
    document.removeEventListener('mousemove', onMove);
    window.removeEventListener('resize', onResize);
    document.body.classList.remove('tv-overlay', 'tv-mode', 'pub-idle');
    try { if (wake) wake.release(); } catch { /* ignore */ }
    store.setInterval(20000);
  };
}
