// 6. Үр дүн — 20 тоглолтын оноо (урьдчилсан/баталгаажсан), техникийн ялагдал, OT, хуваарь өөрчлөх,
// хэсгийн байр (урьдчилсан), сугалаа (lot), хэсгийн дүн батлах, эцсийн байр.
import { h, toast, fmtTime, fmtDate, fmtDateTime, teamName } from '../ui.js';
import { btn, section, chip, confirmDialog, matchStatusChip, MATCH_STATUS } from './core.js';
import {
  forfeitScore, isKnockout, isOvertime, parseScore, isoToLocalInput, localInputToIso, SEAT_CYR, DRAW_GROUPS, mntText,
} from './util.js';
import { resolveMatches, groupStandings, validScore, finalRanking, srcLabel } from '../logic.js';
import { MATCHES, PRIZES } from '../event.js';

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

function matchCard(ctx, m, mo, mp) {
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
    h('div', { class: 'adm-score-row' },
      h('span', { class: 'adm-tname' }, nameA),
      inA, h('span', { class: 'adm-colon' }, ':'), inB,
      h('span', { class: 'adm-tname right' }, nameB),
      ot),
    known ? null : h('p', { class: 'small muted' }, m.stage === 'group' ? 'Сугалааны дараа багууд тодорно.' : 'Багууд тодроогүй (хэсгийн дүн эсвэл өмнөх тоглолт дуусаагүй).'),
    h('div', { class: 'row' }, ff,
      btn('Урьдчилсан', () => save('reported'), 'secondary small-btn', { disabled: !known }),
      btn('Батлах', () => save('final'), 'small-btn', { disabled: !known })),
    msg,
    move);
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
    h('p', { class: 'muted small' }, `Цом, медаль, мөнгөн шагналыг зөвхөн ангийн багт олгоно; мөнгийг хаалтын үеэр баг хүлээн авч, ахлагч шагналын бүртгэлд гарын үсэг зурна. MVP (жижиг цом + ${mntText(PRIZES.mvp_cash)}) — ангийн багийн тоглогчдоос ерөнхий шүүгч ба зохион байгуулагч бүх тоглолтын статистикаар (MatchZy) шалгаруулна.`));
}

export function render(panel, ctx) {
  const st = ctx.state;
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
  for (const [title, list] of days) {
    if (!list.length) continue;
    panel.appendChild(h('section', { class: 'adm-sec-plain' },
      h('h2', {}, `${title} — ${fmtDate(list[0].start)}`),
      h('div', { class: 'adm-matches' }, list.map((m) => matchCard(ctx, m, by(official, m.no), by(prov, m.no))))));
  }
}
