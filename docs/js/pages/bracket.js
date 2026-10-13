// «Схем» хуудас: шөвгийн 8 → шөвгийн 4 → финал + 3-р байр. Утсанд дараалсан, ≥900px-д мод хэлбэртэй.
// Шагналын тавцан: зөвхөн ангийн баг (багш нарын дүрэм). bracketTree-г tv.js бас ашиглана.
import { h, clear, fmtTime } from '../ui.js';
import { STATION_LABEL } from '../event.js';
import { finalRanking } from '../logic.js';
import {
  bindState, makeClock, mergedMatches, offlineNote, publicView, safe, teamLabel, sideInfo,
  isDone, isNow, winnerSide, statusOf, STAGE_LABEL,
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
  return h('div', { class: `bk-box bks-${m.stage}${live ? ' is-now' : ''}${done ? ' is-done' : ''}` },
    h('div', { class: 'bk-bh' },
      h('b', {}, label),
      h('span', { class: 'bk-when' }, `${fmtTime(m.start)} · ${STATION_LABEL[m.station] || ''}`),
      live ? h('span', { class: 'chip pub-now' }, 'ОДОО') : (st.key === 'reported' ? h('span', { class: 'bk-prov' }, 'урьдчилсан') : null)),
    row('a'), row('b'),
    done && (m.forfeit || m.ot) ? h('div', { class: 'bk-foot' }, m.forfeit ? 'Техникийн ялалт' : 'Нэмэлт цагтай') : null);
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
    h('div', { class: 'bk-champ-t' }, 'Аварга'),
    h('div', { class: 'bk-champ-n' }, name || '?'),
    h('div', { class: 'bk-champ-p' }, 'Шилжин явах цом · алтан медаль · өргөмжлөл'));
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
    h('h3', { class: 'bk-h bk-h3' }, 'Финал, 3-р байр', h('span', {}, t(19))),
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
      step(2, '2-р байр', 'Мөнгөн медаль, өргөмжлөл'),
      step(1, 'Аварга', 'Шилжин явах цом, алтан медаль, өргөмжлөл'),
      step(3, '3-р байр', 'Хүрэл медаль, өргөмжлөл')),
    places.every((x) => x != null) ? null
      : h('p', { class: 'muted small center' }, 'Финал, 3-р байрын тоглолт 10.25 (Ня) 14:45-д. Дүн баталгаажмагц энд гарна.'),
    award ? h('p', { class: 'pd-award' }, award === 'honor'
      ? 'Багш нарын баг: «Хүндэт байр» өргөмжлөл (шөвгийн 4-т шалгарсан).'
      : 'Багш нарын баг: «Тусгай өргөмжлөл».') : null,
    h('div', { class: 'pd-rule' },
      h('b', {}, 'Багш нарын багийн дүрэм'),
      h('p', {}, 'Цом, медалийг зөвхөн ангийн баг авна. Цомыг ганц баг өргөнө.'),
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
    h('p', { class: 'muted' }, '10.25 (Ням). Ялагдсан баг хасагдана. Тэнцвэл нэмэлт цаг (MR3).'),
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
      'А№1 = А хэсгийн 1-р байр, Б№2 = Б хэсгийн 2-р байр. Нэг хэсгийн 2 баг зөвхөн финал эсвэл 3-р байрын тоглолтод таарч болно.'));
    body.appendChild(podium(cur));
  };
  const unbind = bindState(body, (s, i) => { cur = s; info = i; draw(); }, clock);
  const tick = setInterval(draw, 30000);
  return () => { unbind(); clearInterval(tick); };
}
