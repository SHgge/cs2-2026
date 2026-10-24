// «Схем» хуудас: шөвгийн 8 → шөвгийн 4 → финал + 3-р байр. Утсанд дараалсан, ≥900px-д мод хэлбэртэй.
// Шагналын тавцан: зөвхөн ангийн баг (багш нарын дүрэм). bracketTree-г tv.js бас ашиглана.
import { h, clear, fmtTime, mnt } from '../ui.js';
import { STATION_LABEL, CHAMPION_TITLE, PRIZES } from '../event.js';
import { finalRanking } from '../logic.js';
import {
  bindState, makeClock, mergedMatches, offlineNote, publicView, safe, teamLabel, sideInfo,
  isDone, isNow, winnerSide, statusOf, STAGE_LABEL, isBo3, seriesInfo,
} from './schedule.js';

function koBox(state, m, now, compact) {
  if (!m) return h('div', { class: 'bk-box' }, '—');
  const done = isDone(m);
  const live = isNow(m, now);
  const win = done ? winnerSide(m) : null;
  const st = statusOf(m);
  const row = (side) => {
    const s = sideInfo(state, m, side, { long: !compact });
    const sc = side === 'a' ? m.score_a : m.score_b;
    return h('div', { class: `bk-row${win === side ? ' win' : win ? ' lost' : ''}` },
      h('span', { class: `bk-team${s.known ? '' : ' ph'}`, title: s.known ? null : s.title }, s.text),
      h('span', { class: 'bk-sc' }, done && sc != null ? String(sc) : ''));
  };
  const label = m.stage === 'final' ? 'Финал' : m.stage === 'third' ? '3-р байр' : (m.code || STAGE_LABEL[m.stage] || '');
  const foot = footText(state, m, done);
  return h('div', { class: `bk-box bks-${m.stage}${live ? ' is-now' : ''}${done ? ' is-done' : ''}` },
    h('div', { class: 'bk-bh' },
      h('b', {}, label),
      h('span', { class: 'bk-when' }, `${fmtTime(m.start)} · ${STATION_LABEL[m.station] || ''}`),
      live ? h('span', { class: 'chip pub-now' }, 'ОДОО') : (st.key === 'reported' ? h('span', { class: 'bk-prov' }, 'урьдчилсан') : null)),
    row('a'), row('b'),
    foot ? h('div', { class: 'bk-foot' }, foot) : null);
}

/** Хайрцгийн доод мөр: техникийн ялалт / нэмэлт цаг; Bo3 бол «Bo3 · 13:9, 9:13, 13:11» (газрын нэр, тоглосон газрын оноо). */
function footText(state, m, done) {
  if (done && m.forfeit) return 'Техникийн ялалт';
  const si = seriesInfo(state, m);
  if (si) {
    const played = si.rows.filter((r) => r.a != null && r.b != null);
    if (played.length) return `Bo3 · ${played.map((r) => `${r.a}:${r.b}`).join(', ')}`;
    return si.rows.length ? `Bo3 · ${si.rows.map((r) => r.name).join(', ')}` : 'Bo3';
  }
  return done && m.ot ? 'Нэмэлт цагтай' : null;
}

/** Ангийн 1–3-р байр (logic.finalRanking: байр бүр тодорхой болмогц бөглөгдөнө) ба багш нарын өргөмжлөл. */
export function placesOf(state) {
  const fr = safe(() => finalRanking(publicView(state)), null);
  const places = [0, 1, 2].map((i) => (fr && Array.isArray(fr.classPlaces) ? fr.classPlaces[i] ?? null : null));
  return { places, award: (fr && fr.teachersAward) || null };
}

function championBox(state, places) {
  const name = teamLabel(state, places[0]);
  return h('div', { class: `bk-champ${name ? ' won' : ''}` },
    h('div', { class: 'bk-champ-t' }, CHAMPION_TITLE),
    h('div', { class: 'bk-champ-n' }, name || '?'),
    h('div', { class: 'bk-champ-p' }, `Шилжин явах цом · алтан медаль · өргөмжлөл · ${mnt(PRIZES.place[0])}`));
}

/** Хасагдах шатны мод. compact = ТВ. */
export function bracketTree(state, { now = Date.now(), compact = false, rows = null } = {}) {
  const r = rows || mergedMatches(state);
  const by = new Map(r.map((m) => [m.no, m]));
  const B = (no) => koBox(state, by.get(no), now, compact);
  const t = (no) => (by.get(no) ? fmtTime(by.get(no).start) : '');
  const { places } = placesOf(state);
  return h('div', { class: `bk${compact ? ' bk-compact' : ''}` },
    h('h3', { class: 'bk-h bk-h1' }, 'Шөвгийн 8', h('span', {}, `${t(13)}, ${t(15)}`)),
    h('div', { class: 'bk-cell bk-q1' }, B(13)),
    h('div', { class: 'bk-cell bk-q2' }, B(15)),
    h('div', { class: 'bk-cell bk-q3' }, B(14)),
    h('div', { class: 'bk-cell bk-q4' }, B(16)),
    h('h3', { class: 'bk-h bk-h2' }, 'Шөвгийн 4', h('span', {}, t(17))),
    h('div', { class: 'bk-cell bk-s1' }, B(17)),
    h('div', { class: 'bk-cell bk-s2' }, B(18)),
    h('h3', { class: 'bk-h bk-h3' }, 'Финал, 3-р байр', h('span', {}, isBo3(by.get(19)) ? `${t(19)} · Bo3` : t(19))),
    h('div', { class: 'bk-cell bk-f' }, championBox(state, places), B(19), B(20)));
}

export function podium(state) {
  const { places, award } = placesOf(state);
  const step = (n, title, prize) => h('div', { class: `pd-step pd-${n}` },
    h('div', { class: 'pd-name' }, teamLabel(state, places[n - 1]) || '?'),
    h('div', { class: 'pd-block' }, h('b', {}, String(n)), h('span', {}, title)),
    h('div', { class: 'pd-prize' }, prize));
  return h('section', { class: 'card pd-wrap', 'aria-label': 'Шагналт байр' },
    h('h2', {}, 'Шагналт байр'),
    h('div', { class: 'pd' },
      step(2, '2-р байр', `Мөнгөн медаль, өргөмжлөл, ${mnt(PRIZES.place[1])}`),
      step(1, 'Аварга', `Шилжин явах цом, алтан медаль, өргөмжлөл, ${mnt(PRIZES.place[0])}`),
      step(3, '3-р байр', `Хүрэл медаль, өргөмжлөл, ${mnt(PRIZES.place[2])}`)),
    places.every((x) => x != null) ? null
      : h('p', { class: 'muted small center' }, 'Финал, 3-р байрын тоглолт 10.25 (Ня) 14:30-д, Bo3. Дүн баталгаажмагц энд гарна.'),
    h('p', { class: 'pd-mvp' }, h('b', {}, 'Тэмцээний шилдэг тоглогч (MVP): '),
      `жижиг цом, ${mnt(PRIZES.mvp_cash)}, өргөмжлөл. Зөвхөн ангийн багийн тоглогчдоос сонгож, хаалтын ёслолд зарлана. Шагналын сан ${mnt(PRIZES.fund)} (MVP орсон).`),
    award ? h('p', { class: 'pd-award' }, award === 'honor'
      ? 'Багш нарын баг: «Хүндэт байр» өргөмжлөл (шөвгийн 4-т шалгарсан).'
      : 'Багш нарын баг: «Тусгай өргөмжлөл».') : null,
    h('div', { class: 'pd-rule' },
      h('b', {}, 'Багш нарын багийн дүрэм'),
      h('p', {}, 'Цом, медаль, мөнгөн шагналыг зөвхөн ангийн баг авна. Цомыг ганц баг өргөнө.'),
      h('p', {}, 'Багш нарын баг түрүүлбэл финалд ялагдсан анги аварга болно. 3-р байрын тоглолтын ялагч 2-р, ялагдагч 3-р байр эзэлнэ.'),
      h('p', {}, 'Багш нарын баг шөвгийн 4-т ялагдвал 3-р байрын тоглолтод тэдэнтэй тоглосон анги 3-р байр эзэлнэ.')));
}

export default async function render(root) {
  const clock = makeClock();
  let cur = null;
  let info = {};
  const body = h('div', { class: 'bk-body' });
  clear(root);
  root.appendChild(h('div', { class: 'pub bkp' },
    h('h1', {}, 'Хасагдах шат'),
    h('p', { class: 'muted' }, '10.25 (Ням). Ялагдсан баг хасагдана. Тэнцвэл нэмэлт цаг (MR3). Финал, 3-р байрын тоглолт Bo3: 2 газрын зураг түрүүлж хожсон баг ялна.'),
    body));
  const draw = () => {
    if (!cur) return;
    const now = clock.now();
    const rows = mergedMatches(cur);
    clear(body);
    const note = offlineNote(info);
    if (note) body.appendChild(note);
    body.appendChild(bracketTree(cur, { now, rows }));
    body.appendChild(h('p', { class: 'small muted bk-legend' },
      'А№1 = А хэсгийн 1-р байр, Б№2 = Б хэсгийн 2-р байр. Нэг хэсгийн 2 баг дахин таарвал зөвхөн финал эсвэл 3-р байрын тоглолтод таарна.'));
    body.appendChild(podium(cur));
  };
  const unbind = bindState(body, (s, i) => { cur = s; info = i; draw(); }, clock);
  const tick = setInterval(draw, 30000);
  return () => { unbind(); clearInterval(tick); };
}
