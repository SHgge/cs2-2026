// «Хэсгүүд» хуудас: 4 хэсгийн байр (Т Х Тэ Я Р± О), урьдчилсан/эцсийн тэмдэг, сугалааны тэмдэглэл, тоглолтууд.
// groupCard-ыг tv.js бас ашиглана. Зөвхөн ангийн нэр харуулна.
import { h, clear } from '../ui.js';
import { GROUPS, GROUP_LABEL, STATION_LABEL, TEAMS } from '../event.js';
import { groupStandings } from '../logic.js';
import {
  bindState, makeClock, mergedMatches, matchCard, offlineNote, publicView, drawPublished, safe, teamLabel, nameByCode,
} from './schedule.js';

const GROUP_STATION = { A: 'A', V: 'A', B: 'B', G: 'B' };
const STATUS = {
  pending: ['Эхлээгүй', 'pub-muted'],
  provisional: ['Урьдчилсан дүн', 'warn'],
  needs_lot: ['Сугалаа хэрэгтэй', 'warn'],
  complete: ['Бүх тоглолт дууссан', 'ok'],
};
const POT_NAME = { 1: '1-р сагс', 2: '2-р сагс', 3: '3-р сагс' };

function seatText(grp, seat) {
  if (seat == null || seat === '') return '';
  const n = String(seat).replace(/^\D+/, '');
  return `${GROUP_LABEL[grp] || grp}${n}`;
}
function signed(n) {
  if (n == null || !Number.isFinite(Number(n))) return '–';
  const v = Number(n);
  return v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0';
}
const num = (v) => (v == null ? '–' : String(v));
const th = (label, title) => h('th', { scope: 'col', class: 'num' }, h('abbr', { title }, label));

function standingRows(state, grp, st, drawn, compact) {
  const status = (st && st.status) || 'pending';
  if (drawn && st && Array.isArray(st.rows) && st.rows.length) {
    const rows = st.rows.slice().sort((a, b) => (a.rank ?? 9) - (b.rank ?? 9));
    return rows.map((r) => h('tr', { class: status === 'complete' && r.rank != null && r.rank <= 2 ? 'gp-q' : '' },
      h('td', { class: 'num gp-rank' }, num(r.rank)),
      h('td', { class: 'gp-team' }, h('b', {}, teamLabel(state, r.teamId) || '—'),
        compact ? null : h('span', { class: 'gp-seat' }, seatText(grp, r.seat))),
      h('td', { class: 'num' }, num(r.p)), h('td', { class: 'num' }, num(r.w)), h('td', { class: 'num' }, num(r.d)),
      h('td', { class: 'num' }, num(r.l)), h('td', { class: 'num' }, signed(r.rd)),
      h('td', { class: 'num gp-pts' }, h('b', {}, num(r.pts)))));
  }
  // Сугалааны өмнө (эсвэл тооцоолж чадаагүй үед): суудлууд
  const codes = drawn && state.draw.groups && Array.isArray(state.draw.groups[grp]) ? state.draw.groups[grp] : null;
  return [1, 2, 3].map((seat) => h('tr', {},
    h('td', { class: 'num gp-rank' }, '–'),
    h('td', { class: 'gp-team' },
      h('b', {}, codes && codes[seat - 1] ? nameByCode(state, codes[seat - 1]) : `${GROUP_LABEL[grp]}${seat}`),
      compact ? null : h('span', { class: 'gp-seat' }, codes ? seatText(grp, seat) : POT_NAME[seat])),
    ...['–', '–', '–', '–', '–'].map((x) => h('td', { class: 'num' }, x)),
    h('td', { class: 'num gp-pts' }, '–')));
}

function groupNote(state, grp, st, drawn, dec) {
  if (!drawn) return h('p', { class: 'gp-note muted small' }, 'Сугалаа 10.22 (Пү) 16:00-д болно.');
  const status = (st && st.status) || 'pending';
  if (status === 'needs_lot') {
    const names = (st.tied || []).map((blk) => (blk || []).map((id) => teamLabel(state, id) || '—').join(', ')).filter(Boolean);
    return h('p', { class: 'gp-note warn' },
      names.length ? `${names.join('; ')}: бүх шалгуураар тэнцсэн. ` : 'Бүх шалгуураар тэнцсэн багууд байна. ',
      'Ерөнхий шүүгч ахлагчдын дэргэд сугалаагаар байрыг тогтооно.');
  }
  if (dec && Array.isArray(dec.lot) && dec.lot.length) return h('p', { class: 'gp-note muted small' }, 'Тэнцсэн багуудын байрыг сугалаагаар тогтоосон.');
  if (status === 'provisional') return h('p', { class: 'gp-note muted small' }, 'Урьдчилсан дүн. Шүүгч баталгаажуултал өөрчлөгдөж болно.');
  if (status === 'complete') return h('p', { class: 'gp-note muted small' }, '1, 2-р байр шөвгийн 8-д шалгарлаа.');
  return null;
}

/** Нэг хэсгийн карт. compact = ТВ-д зориулсан (тоглолтын жагсаалтгүй). */
export function groupCard(state, grp, { compact = false, now = Date.now(), rows = null } = {}) {
  const drawn = drawPublished(state);
  const st = drawn ? safe(() => groupStandings(publicView(state), grp, { official: false }), null) : null;
  const dec = (state && state.decisions && state.decisions[grp]) || {};
  const status = (st && st.status) || 'pending';
  const [stText, stCls] = dec.approved ? ['Баталгаажсан ✓', 'ok'] : (STATUS[status] || STATUS.pending);
  const table = h('table', { class: 'tbl gp-tbl' },
    h('caption', { class: 'visually-hidden' }, `${GROUP_LABEL[grp]} хэсгийн байр`),
    h('thead', {}, h('tr', {},
      th('#', 'Байр'), h('th', { scope: 'col' }, 'Баг'),
      th('Т', 'Тоглосон'), th('Х', 'Хожил'), th('Тэ', 'Тэнцээ'), th('Я', 'Ялагдал'), th('Р±', 'Раундын зөрүү'), th('О', 'Оноо'))),
    h('tbody', {}, standingRows(state, grp, st, drawn, compact)));
  let list = null;
  if (!compact) {
    const ms = (rows || mergedMatches(state)).filter((m) => m.stage === 'group' && m.grp === grp);
    list = h('div', { class: 'gp-ms' }, h('h3', {}, 'Тоглолтууд'), ms.map((m) => matchCard(state, m, now, { station: false, time: true, stage: false })));
  }
  return h('section', { class: `gp-card gc-${grp}${compact ? ' compact' : ''}`, 'aria-label': `${GROUP_LABEL[grp]} хэсэг` },
    h('header', { class: 'gp-head' },
      h(compact ? 'h3' : 'h2', { class: 'gp-title' }, `${GROUP_LABEL[grp]} хэсэг`),
      h('span', { class: 'gp-stn' }, STATION_LABEL[GROUP_STATION[grp]] || ''),
      h('span', { class: `chip ${stCls}` }, stText)),
    h('div', { class: 'table-scroll' }, table),
    compact ? null : groupNote(state, grp, st, drawn, dec),
    list);
}

function potsCard(state) {
  return h('div', { class: 'card gp-pots' },
    h('h2', {}, 'Сагс'),
    [1, 2, 3].map((p) => h('p', {}, h('b', {}, `${POT_NAME[p]}: `),
      TEAMS.filter((t) => t.pot === p).map((t) => nameByCode(state, t.code)).join(', '))),
    h('p', { class: 'muted small' }, 'Хэсэг бүрт сагс тус бүрээс нэг баг орно. А1 = 1-р сагсны баг.'));
}

function legendEl() {
  return h('div', { class: 'gp-legend small muted' },
    h('p', {}, 'Т — тоглосон, Х — хожил, Тэ — тэнцээ, Я — ялагдал, Р± — раундын зөрүү, О — оноо.'),
    h('p', {}, 'Байр: оноо → хоорондын тоглолт → раундын зөрүү → хожсон раунд → Ерөнхий шүүгчийн сугалаа.'),
    h('p', {}, 'Хожил 3, тэнцээ (12:12) 1, хожигдол 0 оноо.'));
}

export default async function render(root) {
  const clock = makeClock();
  let cur = null;
  let info = {};
  const body = h('div', { class: 'gp-body' });
  clear(root);
  root.appendChild(h('div', { class: 'pub gp' },
    h('h1', {}, 'Хэсгүүд'),
    h('p', { class: 'muted' }, '4 хэсэг, хэсэг бүрт 3 баг. 1, 2-р байр шөвгийн 8-д шалгарна.'),
    body));
  const draw = () => {
    if (!cur) return;
    const now = clock.now();
    const rows = mergedMatches(cur);
    clear(body);
    const note = offlineNote(info);
    if (note) body.appendChild(note);
    if (!drawPublished(cur)) body.appendChild(potsCard(cur));
    body.appendChild(h('div', { class: 'gp-grid' }, GROUPS.map((g) => groupCard(cur, g, { now, rows }))));
    body.appendChild(legendEl());
  };
  const unbind = bindState(body, (s, i) => { cur = s; info = i; draw(); }, clock);
  const tick = setInterval(draw, 30000);
  return () => { unbind(); clearInterval(tick); };
}
