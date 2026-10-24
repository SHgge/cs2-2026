// 6. Үр дүн — 20 тоглолтын оноо (урьдчилсан/баталгаажсан), техникийн ялагдал, OT, хуваарь өөрчлөх,
// хэсгийн байр (урьдчилсан), сугалаа (lot), хэсгийн дүн батлах, эцсийн байр, газрын зургийн хасалт (veto.js).
// Bo3 (best_of = 3: финал №19, 3-р байр №20): газар бүрийн оноо (3 мөр), цувралын оноо автоматаар (2:0 / 2:1),
// техникийн ялагдал = цуврал 2:0; хадгалахад match_result {games:[{a,b}]} илгээнэ.
import { h, toast, fmtTime, fmtDate, fmtDateTime, teamName } from '../ui.js';
import { btn, section, chip, confirmDialog, matchStatusChip, MATCH_STATUS } from './core.js';
import {
  forfeitScore, isKnockout, isOvertime, parseScore, isoToLocalInput, localInputToIso, SEAT_CYR, DRAW_GROUPS, mntText,
  seriesScore, seriesForfeitScore, gamesText,
} from './util.js';
import { resolveMatches, groupStandings, validScore, finalRanking, srcLabel, bestOf, mapPool, mapInfo, vetoState } from '../logic.js';
import { MATCHES, PRIZES } from '../event.js';
import { vetoBox, vetoEnabled, VETO_OFF_TEXT } from './veto.js';

const GROUP_STATUS = {
  pending: ['Эхлээгүй', ''], provisional: ['Урьдчилсан', 'gold'], needs_lot: ['Сугалаа хэрэгтэй', 'err'], complete: ['Дууссан', 'ok'],
};
const STAGE_LABEL = { qf: 'Шөвгийн 8', sf: 'Шөвгийн 4', final: 'Финал', third: '3-р байр' };

function isValid(stage, a, b, f) {
  try {
    const v = validScore(stage, a, b, f);
    return v && typeof v === 'object' ? !!v.ok : !!v;
  } catch { return false; }
}
const safe = (fn, fallback) => { try { return fn(); } catch (e) { console.error(e); return fallback; } };
const def = (no) => MATCHES.find((x) => x.no === no) || {};
const sameTime = (a, b) => Date.parse(a || '') === Date.parse(b || '');

function matchCard(ctx, m, mo, mp, ui, vetoOn) {
  const st = ctx.state;
  const d = def(m.no);
  const ta = mo && mo.team_a != null ? mo.team_a : null;
  const tb = mo && mo.team_b != null ? mo.team_b : null;
  const label = (id, src, provId) => {
    if (id != null) return teamName(st, id);
    const s = srcLabel(src, { long: true }) || '—';
    return provId != null ? `${s} (урьдч.: ${teamName(st, provId)})` : s;
  };
  const nameA = label(ta, d.src_a, mp && mp.team_a);
  const nameB = label(tb, d.src_b, mp && mp.team_b);
  const known = ta != null && tb != null;
  const ko = isKnockout(m.stage);

  const bo3 = bestOf(m) === 3;
  const score = bo3 ? seriesBlock(ctx, m, { nameA, nameB, known, ta, tb }) : bo1Block(ctx, m, { nameA, nameB, known, ta, tb, ko });

  // schedule move
  const when = h('input', { type: 'datetime-local', step: 300, 'aria-label': 'Эхлэх цаг' });
  when.value = isoToLocalInput(m.start);
  const station = h('select', { 'aria-label': 'Станц' }, h('option', { value: 'A' }, 'А станц'), h('option', { value: 'B' }, 'Б станц'));
  station.value = m.station === 'B' ? 'B' : 'A';
  const stSel = h('select', { 'aria-label': 'Төлөв' },
    h('option', { value: '' }, 'Төлөв — өөрчлөхгүй'),
    h('option', { value: 'scheduled' }, MATCH_STATUS.scheduled[0]),
    h('option', { value: 'live' }, MATCH_STATUS.live[0]));
  for (const el of [when, station, stSel]) el.addEventListener('change', () => ctx.setDirty(true));
  const move = h('details', { class: 'adm-move' },
    h('summary', {}, 'Хуваарь, төлөв өөрчлөх'),
    h('div', { class: 'adm-inline' }, when, station, stSel,
      btn('Хадгалах', async () => {
        const args = { no: m.no };
        const iso = localInputToIso(when.value);
        if (iso && !sameTime(iso, m.start)) args.start = iso;
        if (station.value !== m.station) args.station = station.value;
        if (stSel.value && stSel.value !== m.status) args.status = stSel.value;
        if (Object.keys(args).length === 1) { toast('Өөрчлөлт алга.', 'warn'); return; }
        const lines = [];
        if (args.start) lines.push(`Шинэ цаг: ${fmtDateTime(args.start)}`);
        if (args.station) lines.push(`Шинэ станц: ${args.station === 'A' ? 'А' : 'Б'} станц`);
        if (args.status) lines.push(`Төлөв: ${MATCH_STATUS[args.status][0]}`);
        if (args.status === 'scheduled' && (m.status === 'reported' || m.status === 'final')) lines.push('Анхаар: оруулсан оноо хүчингүй болж магадгүй.');
        else if (args.status === 'scheduled' && bo3 && Array.isArray(m.games) && m.games.length) lines.push('Анхаар: цувралын газрын оноо устна.');
        const ok = await confirmDialog({ title: `№${m.no} — хуваарь өөрчлөх үү?`, text: lines, ok: 'Хадгалах' });
        if (ok) await ctx.act('match_update', args, `№${m.no} шинэчиллээ`);
      }, 'secondary small-btn')));

  const tag = m.stage === 'group'
    ? h('span', { class: `chip grp-${m.grp}` }, `${SEAT_CYR[m.grp] || m.grp} хэсэг`)
    : h('span', { class: 'chip' }, m.code || STAGE_LABEL[m.stage] || m.stage);
  return h('article', { class: `adm-match st-${m.status || 'scheduled'}` },
    h('header', { class: 'row' },
      h('b', {}, `№${m.no}`),
      h('span', { class: 'muted small' }, `${fmtTime(m.start)} · ${m.station === 'B' ? 'Б' : 'А'} станц`),
      tag,
      h('span', { class: 'spacer' }),
      matchStatusChip(m.status)),
    vetoOn ? safe(() => vetoBox(ctx, m.no, { nameA, nameB, known }, ui), null) : null,
    score.rows,
    known ? null : h('p', { class: 'small muted' }, m.stage === 'group' ? 'Сугалааны дараа багууд тодорно.' : 'Багууд тодроогүй (хэсгийн дүн эсвэл өмнөх тоглолт дуусаагүй).'),
    h('div', { class: 'row' }, score.ff,
      btn('Урьдчилсан', () => score.save('reported'), 'secondary small-btn', { disabled: !known }),
      btn('Батлах', () => score.save('final'), 'small-btn', { disabled: !known })),
    score.msg,
    move);
}

/** Bo1 score row (one a:b pair, OT chip, forfeit 13:0). Returns {rows, ff, msg, save(status)}. */
function bo1Block(ctx, m, { nameA, nameB, known, ta, tb, ko }) {
  const inA = h('input', { type: 'text', inputmode: 'numeric', maxlength: 2, class: 'adm-score', 'aria-label': `№${m.no} ${nameA} оноо` });
  const inB = h('input', { type: 'text', inputmode: 'numeric', maxlength: 2, class: 'adm-score', 'aria-label': `№${m.no} ${nameB} оноо` });
  inA.value = m.score_a == null ? '' : String(m.score_a);
  inB.value = m.score_b == null ? '' : String(m.score_b);
  const ff = h('select', { 'aria-label': `№${m.no} техникийн ялагдал` },
    h('option', { value: '' }, 'Техникийн ялагдал — үгүй'),
    h('option', { value: 'a' }, `${nameA} — техникийн ялагдал`),
    h('option', { value: 'b' }, `${nameB} — техникийн ялагдал`));
  ff.value = m.forfeit === 'a' || m.forfeit === 'b' ? m.forfeit : '';
  const msg = h('p', { class: 'field-error', role: 'alert' });
  const ot = h('span', { class: 'chip gold', hidden: true }, 'OT');

  const current = () => {
    const f = ff.value || null;
    const fs = forfeitScore(f);
    return { f, a: fs ? fs.a : parseScore(inA.value), b: fs ? fs.b : parseScore(inB.value) };
  };
  const check = () => {
    const { a, b, f } = current();
    if (a == null || b == null) return 'Хоёр багийн оноог оруулна уу.';
    if (!isValid(m.stage, a, b, f)) {
      return ko ? 'Хасагдах шат: 13:0–11, эсвэл нэмэлт цагтай (16:14, 19:15 …).' : 'Хэсгийн шат: 13:0–11 эсвэл 12:12 (тэнцээ).';
    }
    return null;
  };
  const sync = () => {
    const fs = forfeitScore(ff.value || null);
    inA.disabled = !!fs || !known;
    inB.disabled = !!fs || !known;
    if (fs) { inA.value = String(fs.a); inB.value = String(fs.b); }
    const { a, b } = current();
    ot.hidden = !isOvertime(m.stage, a, b);
  };
  const onEdit = () => { ctx.setDirty(true); sync(); msg.textContent = ''; };
  inA.addEventListener('input', onEdit);
  inB.addEventListener('input', onEdit);
  ff.addEventListener('change', onEdit);
  ff.disabled = !known;
  sync();

  const save = async (status) => {
    const err = check();
    if (err) { msg.textContent = err; return; }
    const { a, b, f } = current();
    if (m.status === 'final' && (a !== m.score_a || b !== m.score_b || (f || null) !== (m.forfeit || null) || status !== 'final')) {
      const ok = await confirmDialog({ title: `№${m.no} — баталгаажсан оноог өөрчлөх үү?`, text: `${nameA} ${a} : ${b} ${nameB}`, ok: 'Өөрчлөх', danger: true });
      if (!ok) return;
    }
    await ctx.act('match_result', {
      no: m.no, score_a: a, score_b: b, forfeit: f, ot: isOvertime(m.stage, a, b), team_a: ta, team_b: tb, status,
    }, status === 'final' ? `№${m.no} баталгаажлаа` : `№${m.no} хадгаллаа`);
  };

  const rows = h('div', { class: 'adm-score-row' },
    h('span', { class: 'adm-tname' }, nameA),
    inA, h('span', { class: 'adm-colon' }, ':'), inB,
    h('span', { class: 'adm-tname right' }, nameB),
    ot);
  return { rows, ff, msg, save };
}

const SERIES_ERR = {
  incomplete: (n) => `${n}-р газрын хоёр багийн оноог оруулна уу.`,
  gap: (n) => `${n}-р газрын өмнөх газрын оноо хоосон байна.`,
  invalid: (n) => `${n}-р газар: 13:0–11, эсвэл нэмэлт цагтай (16:14, 19:15 …); тэнцээ байхгүй.`,
  after_clinch: (n) => `${n}-р газар илүүц — цуврал өмнөх газраар шийдэгдсэн.`,
};

/**
 * Bo3 series block (matches 19, 20): series score (computed, read-only), 3 game rows (map from the veto / stored game,
 * a:b inputs, OT chip, winner), forfeit = series 2:0. Game 3 opens only at 1:1. Save sends
 * match_result {no, games:[{a,b}], forfeit, team_a, team_b, status}; an undecided series stays «Явагдаж буй» on the server.
 * Returns {rows, ff, msg, save(status)}.
 */
function seriesBlock(ctx, m, { nameA, nameB, known, ta, tb }) {
  const v = safe(() => vetoState(m, mapPool(ctx.state)), null);
  const maps = v && Array.isArray(v.maps) && v.maps.length ? v.maps : Array.isArray(m.maps) ? m.maps : [];
  const stored = (Array.isArray(m.games) ? m.games : []).filter((g) => g && typeof g === 'object');
  const mapOf = (i) => (stored[i] && typeof stored[i].map === 'string' && stored[i].map) || maps[i] || null;
  const games = [0, 1, 2].map((i) => {
    const g = stored[i] || {};
    const inA = h('input', { type: 'text', inputmode: 'numeric', maxlength: 2, class: 'adm-score', 'aria-label': `№${m.no} ${i + 1}-р газар ${nameA} оноо` });
    const inB = h('input', { type: 'text', inputmode: 'numeric', maxlength: 2, class: 'adm-score', 'aria-label': `№${m.no} ${i + 1}-р газар ${nameB} оноо` });
    inA.value = g.a == null ? '' : String(g.a);
    inB.value = g.b == null ? '' : String(g.b);
    const key = mapOf(i);
    const ot = h('span', { class: 'chip gold', hidden: true }, 'OT');
    const win = h('span', { class: 'adm-game-w small' });
    const label = h('span', { class: 'adm-game-l' }, h('b', {}, `${i + 1}-р газар`), key ? ` · ${mapInfo(key).name}` : '',
      i === 2 ? h('span', { class: 'muted small' }, ' (шийдвэрлэх)') : null);
    return { inA, inB, ot, win, row: h('div', { class: 'adm-score-row adm-game-row' }, label, inA, h('span', { class: 'adm-colon' }, ':'), inB, win, ot) };
  });
  const ff = h('select', { 'aria-label': `№${m.no} техникийн ялагдал` },
    h('option', { value: '' }, 'Техникийн ялагдал — үгүй'),
    h('option', { value: 'a' }, `${nameA} — техникийн ялагдал (цуврал 0:2)`),
    h('option', { value: 'b' }, `${nameB} — техникийн ялагдал (цуврал 2:0)`));
  ff.value = m.forfeit === 'a' || m.forfeit === 'b' ? m.forfeit : '';
  const msg = h('p', { class: 'field-error', role: 'alert' });
  const total = h('b', { class: 'adm-series-score' }, '–');
  const note = h('p', { class: 'small muted adm-series-note' });

  const read = () => games.map((g) => ({ a: parseScore(g.inA.value), b: parseScore(g.inB.value) }));
  /** {f, s}: s = seriesScore() of the rows, or the forfeit series (2:0, no games). */
  const current = () => {
    const f = ff.value || null;
    const fs = seriesForfeitScore(f);
    if (fs) return { f, s: { ...fs, games: [], decided: true, winner: fs.a > fs.b ? 'a' : 'b', error: null } };
    return { f: null, s: seriesScore(read(), m.stage) };
  };
  const badText = () => {
    for (let i = 0; i < games.length; i += 1) {
      const g = games[i];
      for (const el of [g.inA, g.inB]) if (el.value.trim() && parseScore(el.value) == null) return `${i + 1}-р газар: оноо буруу (0–99).`;
    }
    return null;
  };
  const check = (status) => {
    const { f, s } = current();
    if (f) return null;
    const bad = badText();
    if (bad) return bad;
    if (s.error) return SERIES_ERR[s.error.code](s.error.game);
    if (!s.games.length) return 'Дор хаяж нэг газрын оноог оруулна уу.';
    if (status === 'final' && !s.decided) return 'Цуврал шийдэгдээгүй (аль нэг баг 2 газар хожоогүй) — батлах боломжгүй.';
    return null;
  };
  const sync = () => {
    const { f, s } = current();
    const first2 = seriesScore(read().slice(0, 2), m.stage);
    const open3 = !f && !first2.error && first2.games.length === 2 && first2.a === 1 && first2.b === 1;
    games.forEach((g, i) => {
      const filled = !!(g.inA.value.trim() || g.inB.value.trim());
      const off = !!f || !known || (i === 2 && !open3 && !filled);   // filled game 3 stays editable so it can be cleared
      g.inA.disabled = off;
      g.inB.disabled = off;
      const a = parseScore(g.inA.value);
      const b = parseScore(g.inB.value);
      const ok = !f && a != null && b != null && validScore(m.stage, a, b);   // forfeit: rows kept but ignored
      g.ot.hidden = !(ok && isOvertime(m.stage, a, b));
      g.win.textContent = ok ? `${a > b ? nameA : nameB} хожив` : '';
    });
    if (f) {
      total.textContent = `${s.a} : ${s.b}`;
      note.textContent = 'Техникийн ялагдал — цуврал 2:0, газрын оноо бичихгүй.';
    } else if (s.games.length && !s.error) {
      total.textContent = `${s.a} : ${s.b}`;
      note.textContent = s.decided ? `Ялагч: ${s.winner === 'a' ? nameA : nameB} (${gamesText(s.games)})` : 'Цуврал үргэлжилж байна — 2 газар хожсон баг ялна.';
    } else {
      total.textContent = '–';
      note.textContent = 'Газар бүрийн оноог тоглосон дарааллаар оруулна. 2 газар хожсон баг ялна; 3-р газрыг зөвхөн 1:1 үед.';
    }
  };
  const onEdit = () => { ctx.setDirty(true); sync(); msg.textContent = ''; };
  for (const g of games) { g.inA.addEventListener('input', onEdit); g.inB.addEventListener('input', onEdit); }
  ff.addEventListener('change', onEdit);
  ff.disabled = !known;
  sync();

  const save = async (status) => {
    const err = check(status);
    if (err) { msg.textContent = err; return; }
    const { f, s } = current();
    const list = f ? [] : s.games;
    const was = gamesText(stored.map((g) => ({ a: g.a, b: g.b })));
    const changed = (f || null) !== (m.forfeit || null) || (!f && gamesText(list) !== was);
    if (m.status === 'final' && (changed || status !== 'final')) {
      const ok = await confirmDialog({
        title: `№${m.no} — баталгаажсан цувралыг өөрчлөх үү?`,
        text: [`${nameA} ${s.a} : ${s.b} ${nameB}`, f ? 'Техникийн ялагдал (2:0)' : gamesText(list)],
        ok: 'Өөрчлөх',
        danger: true,
      });
      if (!ok) return;
    }
    const okText = status === 'final' ? `№${m.no} баталгаажлаа`
      : f || s.decided ? `№${m.no} хадгаллаа` : `№${m.no}: ${list.length} газрын оноо хадгаллаа — цуврал үргэлжилнэ`;
    await ctx.act('match_result', { no: m.no, games: list, forfeit: f, team_a: ta, team_b: tb, status }, okText);
  };

  const rows = h('div', { class: 'adm-series' },
    h('div', { class: 'adm-series-head' },
      h('span', { class: 'adm-tname' }, nameA), total, h('span', { class: 'adm-tname right' }, nameB),
      h('span', { class: 'chip' }, 'Bo3')),
    games.map((g) => g.row),
    note);
  return { rows, ff, msg, save };
}

function standingsCard(ctx, g) {
  const st = ctx.state;
  const prov = safe(() => groupStandings(st, g, { official: false }), null);
  const off = safe(() => groupStandings(st, g, { official: true }), null);
  const dec = (st.decisions && st.decisions[g]) || {};
  const [pt, pk] = GROUP_STATUS[off && off.status] || ['—', ''];
  const rows = prov && Array.isArray(prov.rows) ? prov.rows : [];
  const box = h('div', { class: `adm-stand grp-${g}` },
    h('header', { class: 'row' }, h('h3', {}, `${SEAT_CYR[g]} хэсэг`), chip(pt, pk), dec.approved ? chip('Батлагдсан', 'ok') : null),
    h('div', { class: 'table-scroll' }, h('table', { class: 'tbl adm-standtbl' },
      h('thead', {}, h('tr', {}, ['#', 'Баг', 'Т', 'Х', 'Тэ', 'Я', 'Раунд', '±', 'Оноо'].map((x, i) => h('th', { scope: 'col', class: i > 1 ? 'num' : '' }, x)))),
      h('tbody', {}, rows.map((r) => h('tr', {},
        h('td', {}, r.rank == null ? '–' : String(r.rank)),
        h('td', {}, teamName(st, r.teamId)),
        h('td', { class: 'num' }, String(r.p ?? 0)), h('td', { class: 'num' }, String(r.w ?? 0)), h('td', { class: 'num' }, String(r.d ?? 0)), h('td', { class: 'num' }, String(r.l ?? 0)),
        h('td', { class: 'num' }, `${r.rf ?? 0}:${r.ra ?? 0}`),
        h('td', { class: 'num' }, `${(r.rd ?? 0) > 0 ? '+' : ''}${r.rd ?? 0}`),
        h('td', { class: 'num' }, h('b', {}, String(r.pts ?? 0)))))))),
    prov && off && prov.status !== off.status ? h('p', { class: 'muted small' }, 'Хүснэгтэд урьдчилсан оноо орсон.') : null);

  if (off && (off.status === 'needs_lot' || (Array.isArray(dec.lot) && dec.lot.length))) box.appendChild(lotBox(ctx, g, off, dec));

  box.appendChild(h('div', { class: 'row adm-mt' },
    dec.approved
      ? btn('Батлалтыг цуцлах', async () => {
        const ok = await confirmDialog({ title: `${SEAT_CYR[g]} хэсгийн дүнгийн батлалтыг цуцлах уу?`, ok: 'Цуцлах', danger: true });
        if (ok) await ctx.act('group_approve', { grp: g, approved: false }, 'Цуцаллаа');
      }, 'secondary small-btn')
      : btn('Хэсгийн дүнг батлах', async () => {
        const ok = await confirmDialog({ title: `${SEAT_CYR[g]} хэсгийн дүнг батлах уу?`, text: 'Ерөнхий шүүгч шалгасны дараа батална уу.', ok: 'Батлах' });
        if (ok) await ctx.act('group_approve', { grp: g, approved: true }, 'Баталлаа');
      }, 'small-btn', { disabled: !(off && off.status === 'complete') })));
  return box;
}

function lotBox(ctx, g, off, dec) {
  const st = ctx.state;
  const blocks = Array.isArray(off.tied) ? off.tied.filter((b) => Array.isArray(b) && b.length > 1) : [];
  const box = h('div', { class: 'adm-lot' },
    h('h4', {}, 'Ерөнхий шүүгчийн сугалаа (ахлагч нарын өмнө)'),
    Array.isArray(dec.lot) && dec.lot.length
      ? h('div', { class: 'row' },
        h('p', { class: 'small' }, `Хадгалсан дараалал: ${dec.lot.map((id) => teamName(st, Number(id))).join(' → ')}${dec.lot_reason ? ` (${dec.lot_reason})` : ''}`),
        btn('Сугалааг арилгах', async () => {
          const ok = await confirmDialog({ title: `${SEAT_CYR[g]} хэсгийн сугалааг арилгах уу?`, ok: 'Арилгах', danger: true });
          if (ok) await ctx.act('group_lot', { grp: g, order: null }, 'Сугалааг арилгалаа');
        }, 'secondary small-btn'))
      : null);
  if (!blocks.length) return box;
  const pickers = blocks.map((block) => {
    const sels = block.map((_, i) => {
      const s = h('select', { 'aria-label': `${i + 1}-р байр` }, block.map((id) => h('option', { value: String(id) }, teamName(st, id))));
      s.value = String(block[i]);
      return s;
    });
    box.appendChild(h('div', { class: 'adm-inline' }, h('span', { class: 'small' }, 'Тэнцсэн:'),
      sels.map((s, i) => h('label', { class: 'adm-seat' }, h('b', {}, `${i + 1}.`), s))));
    return { block, sels };
  });
  const reason = h('input', { type: 'text', maxlength: 200, placeholder: 'Жишээ: 16:50-д ахлагч нарын өмнө сугалаа татсан' });
  box.append(h('label', {}, 'Тэмдэглэл', reason),
    btn('Сугалааны дарааллыг хадгалах', async () => {
      const chosen = new Map();
      for (const p of pickers) {
        const ids = p.sels.map((s) => Number(s.value));
        if (new Set(ids).size !== ids.length) { toast('Нэг багийг хоёр удаа сонгосон байна.', 'err'); return; }
        chosen.set(p.block, ids);
      }
      if (reason.value.trim().length < 3) { toast('Тэмдэглэл бичнэ үү.', 'err'); reason.focus(); return; }
      // Бүтэн дараалал: байрны дарааллаар, тэнцсэн хэсгийг сонгосон дарааллаар орлуулна.
      const order = [];
      const emitted = new Set();
      for (const r of off.rows || []) {
        const p = pickers.find((x) => x.block.includes(r.teamId));
        if (p) { if (!emitted.has(p)) { order.push(...chosen.get(p.block)); emitted.add(p); } } else order.push(r.teamId);
      }
      const ok = await confirmDialog({ title: `${SEAT_CYR[g]} хэсгийн сугалааг хадгалах уу?`, text: order.map((id, i) => `${i + 1}. ${teamName(st, id)}`), ok: 'Хадгалах' });
      if (ok) await ctx.act('group_lot', { grp: g, order, reason: reason.value.trim() }, 'Сугалаа хадгаллаа');
    }, 'small-btn'));
  return box;
}

function rankingBox(ctx) {
  const st = ctx.state;
  const fr = safe(() => finalRanking(st), null);
  if (!fr || !Array.isArray(fr.classPlaces) || !fr.classPlaces.some((x) => x != null)) return null;
  const award = fr.teachersAward === 'honor' ? 'Хүндэт байрын өргөмжлөл' : fr.teachersAward === 'special' ? 'Тусгай өргөмжлөл' : null;
  const prize = (i) => (PRIZES.place[i] ? ` — ${mntText(PRIZES.place[i])} (тоглогч бүрт ${mntText(PRIZES.per_player[i])})` : '');
  return section('Эцсийн байр (ангиуд)',
    h('ol', { class: 'adm-podium' }, fr.classPlaces.map((id, i) => h('li', {}, h('b', {}, `${i + 1}-р байр: `), id == null ? '—' : teamName(st, id), id == null ? null : prize(i)))),
    award ? h('p', { class: 'small' }, `Багш нарын баг: ${award}.`) : null,
    h('p', { class: 'muted small' }, `Цом, медаль, мөнгөн шагналыг зөвхөн ангийн багт олгоно; мөнгийг хаалтын үеэр баг хүлээн авч, ахлагч шагналын бүртгэлд гарын үсэг зурна. Шагналын сан ${mntText(PRIZES.fund)} (MVP орсон). MVP (жижиг цом + ${mntText(PRIZES.mvp_cash)}) — ангийн багийн тоглогчдоос ерөнхий шүүгч ба зохион байгуулагч бүх тоглолтын статистикаар (MatchZy) шалгаруулна.`));
}

export function render(panel, ctx, ui = {}) {
  const st = ctx.state;
  const vetoOn = vetoEnabled(st);
  const official = safe(() => resolveMatches(st, { official: true }), st.matches) || st.matches;
  const prov = safe(() => resolveMatches(st, { official: false }), st.matches) || st.matches;
  const by = (list, no) => (list || []).find((x) => x.no === no) || null;

  const rank = rankingBox(ctx);
  if (rank) panel.appendChild(rank);

  panel.appendChild(section('Хэсгийн байр',
    h('p', { class: 'muted small' }, 'Т — тоглосон, Х — хожсон, Тэ — тэнцсэн, Я — ялагдсан. Урьдчилсан оноо мөн тооцогдоно.'),
    h('div', { class: 'adm-stands' }, DRAW_GROUPS.map((g) => standingsCard(ctx, g)))));

  const days = [
    ['1-р өдөр', st.matches.filter((m) => m.stage === 'group')],
    ['2-р өдөр', st.matches.filter((m) => m.stage !== 'group')],
  ];
  if (!vetoOn) panel.appendChild(h('div', { class: 'card warn adm-veto-off', role: 'status' }, `${VETO_OFF_TEXT}.`));
  for (const [title, list] of days) {
    if (!list.length) continue;
    panel.appendChild(h('section', { class: 'adm-sec-plain' },
      h('h2', {}, `${title} — ${fmtDate(list[0].start)}`),
      h('div', { class: 'adm-matches' }, list.map((m) => matchCard(ctx, m, by(official, m.no), by(prov, m.no), ui, vetoOn)))));
  }
}
