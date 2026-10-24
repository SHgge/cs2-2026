// Газрын зургийн хасалт (map veto, журам 02 §7.9) — зохион байгуулагч / ерөнхий шүүгчийн удирдлага.
// results.js тоглолт бүрийн картад vetoBox()-ийг харуулна. 7 газрын зургаас багууд ээлжлэн 3, 3-ыг хасаж, үлдсэнд нь
// тоглоно. Хэсгийн шатанд эхэнд бичигдсэн баг (a) эхэлж хасна; хасагдах шатанд зоос шиднэ. Талыг хутганы раундаар.
// Bo3 (финал №19, 3-р байр №20, best_of = 3): зоосонд ялсан баг эхэлнэ — хасах, хасах, сонгох (1-р газар), сонгох
// (2-р газар), хасах, хасах; үлдсэн нь 3-р газар (шийдвэрлэх). 1-р газарт нөгөө баг, 2-р газарт эхэлсэн баг талаа сонгоно
// (MatchZy map_sides, хуудсанд л — DB-д хадгалахгүй); 3-р газарт хутганы раунд.
// Цэвэр туслахууд (vetoReady, vetoSummary, vetoErrorText, maplistLine, serverCommand, seriesMapsText) DOM ашиглахгүй —
// Node-оор тестэлнэ.
import { h, clear, toast, copyText } from '../ui.js';
import { confirmDialog, errMsg } from './core.js';
import { mapPool, mapInfo, vetoState } from '../logic.js';
import { sideChooser, seriesJsonLines } from './util.js';

export const VETO_OFF_TEXT = 'Газрын зургийн систем хараахан идэвхжээгүй (migration 13)';
export const KNIFE_TEXT = 'Талыг хутганы раундаар сонгоно';
const VETO_FIELDS = ['veto', 'veto_first', 'veto_coin', 'map', 'best_of', 'maps', 'games'];

/** true when the admin overview carries the veto fields (migration 13 applied). */
export function vetoReady(state) {
  return !!(state && Array.isArray(state.matches) && state.matches.some((m) => m && Array.isArray(m.veto)));
}

let actionMissing = false; // the server answered not_found for 'match_veto' (old API) — until the page reloads
/** vetoReady() and the server knows the 'match_veto' action. */
export function vetoEnabled(state) { return !actionMissing && vetoReady(state); }

/**
 * MatchZy match JSON line for the decided map: '"maplist": ["de_mirage"]'. The tech lead puts it in the match JSON
 * before matchzy_loadmatch (tech guide §5.6) — loading the JSON switches the server to maplist[0].
 */
export function maplistLine(key) { return key ? `"maplist": ["${mapInfo(key).id}"]` : ''; }

/** Server console command for the decided map: 'changelevel de_mirage' — only when the JSON is already loaded, before LIVE. */
export function serverCommand(key) { return key ? `changelevel ${mapInfo(key).id}` : ''; }

/** Bo3 maps in game order (picks, then the decider): 'Inferno → Nuke → Mirage'; '' when none. */
export function seriesMapsText(maps) {
  return (Array.isArray(maps) ? maps : []).filter((k) => typeof k === 'string' && k).map((k) => mapInfo(k).name).join(' → ');
}

/** The verb of the next veto step: 'сонгоно' on a Bo3 pick step, else 'хасна'. */
const verbOf = (v) => (v && v.nextAct === 'pick' ? 'сонгоно' : 'хасна');

/**
 * One-line status for the card (shown after «Газрын зураг:»).
 * opts.locked — the match is final (no veto changes); opts.known === false — the teams are not known yet.
 * @param {ReturnType<typeof vetoState>} v
 * @param {string} nameA
 * @param {string} nameB
 * @param {{locked?: boolean, known?: boolean}} [opts]
 * @returns {{text:string, detail:string, kind:''|'warn'|'ok'}}
 */
export function vetoSummary(v, nameA, nameB, opts = {}) {
  const nm = (s) => (s === 'a' ? nameA : s === 'b' ? nameB : '—');
  if (!v) return { text: 'Эхлээгүй', detail: '', kind: '' };
  const bo3 = v.bo === 3;
  if (v.done) return { text: bo3 ? seriesMapsText(v.maps) || '—' : mapInfo(v.map).name, detail: bo3 ? 'Bo3' : '', kind: 'ok' };
  const step = bo3 ? 'алхам' : 'хасалт';
  if (opts.locked) return { text: '—', detail: v.started ? `${step} ${v.steps.length}/${v.total}, дуусаагүй` : 'хасалт бүртгээгүй', kind: '' };
  if (opts.known === false && !v.started) return { text: 'Эхлээгүй', detail: '', kind: '' };
  if (v.started) {
    const head = bo3 ? 'Алхам' : 'Хасалт';
    return { text: `${head} ${v.steps.length}/${v.total}${v.next ? ` — ${nm(v.next.side)} ${verbOf(v)}` : ''}`, detail: '', kind: 'warn' };
  }
  if (!v.first) return { text: 'Эхлээгүй', detail: 'зоос шидээгүй', kind: '' };
  return { text: 'Эхлээгүй', detail: `${nm(v.first)} эхэлж хасна${v.coin ? ' (зоосоор)' : ''}`, kind: '' };
}

const REASON = {
  final: 'Тоглолт баталгаажсан тул хасалтыг өөрчлөх боломжгүй.',
  group_fixed: 'Хэсгийн тоглолтод эхэнд бичигдсэн баг эхэлж хасна — зоос шидэхгүй.',
  veto_started: 'Хасалт эхэлсэн тул эхлэх багийг солих боломжгүй. «Шинээр эхлүүлэх» дарна уу.',
  first_missing: 'Эхлээд зоос шидэж, эхэлж хасах багийг тогтооно уу.',
  veto_done: 'Хасалт аль хэдийн дууссан байна.',
  veto_empty: 'Буцаах хасалт алга.',
  games_started: 'Цувралын газрын оноо орсон тул хасалтыг шүүгч өөрчлөхгүй (зөвхөн ерөнхий шүүгч / админ).',
  pool_small: 'Bo3-д дор хаяж 5 газрын зураг хэрэгтэй.',
};

/** Mongolian text of a failed 'match_veto' answer. */
export function vetoErrorText(r) {
  if (r && r.error === 'not_found' && r.action === 'match_veto') return `${VETO_OFF_TEXT}.`;
  if (r && r.error === 'forbidden' && REASON[r.reason]) return REASON[r.reason];
  if (r && r.error === 'validation') {
    const e = (Array.isArray(r.errors) && r.errors[0]) || {};
    if (e.field === 'map') return e.code === 'taken' ? 'Энэ газрын зураг аль хэдийн хасагдсан (эсвэл сонгогдсон) байна.' : 'Газрын зураг буруу байна.';
    if (e.field === 'side') return 'Эхлэх баг буруу байна.';
    return 'Хүсэлт буруу байна. Хуудсыг шинэчилнэ үү.';
  }
  return errMsg(r);
}

/**
 * Veto control for one match: <details> whose summary is the one-line status and whose body is the full control
 * (coin toss, 7 map buttons with a two-step ban, undo, reset, server command). Open state and the selected map are
 * kept in ui (tab UI state) so they survive re-renders. names: {nameA, nameB, known}.
 */
export function vetoBox(ctx, no, names, ui = {}) {
  const { nameA, nameB, known } = names;
  const open = ui.vetoOpen instanceof Set ? ui.vetoOpen : (ui.vetoOpen = new Set());
  const sels = ui.vetoSel instanceof Map ? ui.vetoSel : (ui.vetoSel = new Map()); // no → {map, step} (ban step 1 of 2)
  const sides = ui.vetoSides instanceof Map ? ui.vetoSides : (ui.vetoSides = new Map()); // Bo3: no → {1:'ct'|'t', 2:…} (page only)
  const box = h('details', { class: 'adm-veto' });
  box.open = open.has(no);
  box.addEventListener('toggle', () => { if (box.open) open.add(no); else open.delete(no); });
  const nm = (s) => (s === 'a' ? nameA : s === 'b' ? nameB : '—');
  const current = () => ((ctx.state && ctx.state.matches) || []).find((x) => x.no === no) || { no };
  let inFlight = false;

  async function send(action, args, okText) {
    if (inFlight) return;
    inFlight = true;
    paint();
    let r;
    try { r = await ctx.call('match_veto', { no, action, ...args }, { quiet: true }); } finally { inFlight = false; }
    if (r && r.ok) {
      sels.delete(no);
      const msg = typeof okText === 'function' ? okText(r) : okText;
      if (msg) toast(msg, 'ok');
      const m = current();
      if (r.match && typeof r.match === 'object' && Array.isArray(r.match.veto) && m.no === no) {
        // Patch only this match (typed scores in other cards stay). ctx.state.version stays old on purpose: the next
        // poll sees the new server version and re-renders, or shows «Шинэ өөрчлөлт ирлээ» while scores are being typed.
        for (const k of VETO_FIELDS) if (k in r.match) m[k] = r.match[k];
        paint();
      } else {
        await ctx.reload();
      }
      return;
    }
    if (!r || r.error === 'bad_session') return;
    if (r.error === 'not_found' && r.action === 'match_veto') {
      actionMissing = true;
      toast(vetoErrorText(r), 'warn', 6000);
      ctx.rerender();
      return;
    }
    toast(vetoErrorText(r), 'err', 6000);
    if (['stale', 'forbidden', 'validation', 'not_found'].includes(r.error)) { sels.delete(no); await ctx.reload(); }
    paint();
  }

  /** Server-action button: disabled while any veto request of this card is in flight. */
  const act = (text, fn, cls, { disabled = false, pressed = null } = {}) => {
    const el = h('button', {
      type: 'button', class: `btn small-btn ${cls}`.trim(), disabled: disabled || inFlight, 'aria-pressed': pressed == null ? null : String(pressed),
    }, text);
    el.addEventListener('click', () => { if (!inFlight && !el.disabled) fn(el); });
    return el;
  };

  function paint() {
    const st = ctx.state || {};
    const m = current();
    const pool = mapPool(st);
    const v = vetoState(m, pool);
    const ko = m.stage != null && m.stage !== 'group';
    const locked = m.status === 'final';
    const can = !!known && !locked && !inFlight;
    const s = sels.get(no);
    const sel = s && s.step === v.steps.length && v.next && v.remaining.includes(s.map) ? s.map : null;
    if (s && !sel) sels.delete(no);
    const sum = vetoSummary(v, nameA, nameB, { locked, known: !!known });

    clear(box);
    box.className = `adm-veto${v.done ? ' is-done' : v.started ? ' is-live' : ''}`;
    if (inFlight) box.setAttribute('aria-busy', 'true'); else box.removeAttribute('aria-busy');
    box.appendChild(h('summary', {},
      h('span', { class: 'adm-veto-k' }, 'Газрын зураг: '),
      h('b', { class: `adm-veto-v ${sum.kind}`.trim() }, sum.text),
      sum.detail ? h('span', { class: 'adm-veto-d' }, ` · ${sum.detail}`) : null));

    const body = h('div', { class: 'adm-veto-body' });
    box.appendChild(body);
    if (!known) {
      body.append(h('p', { class: 'small muted' }, 'Хоёр баг тодорсны дараа хасалт хийнэ.'), h('p', { class: 'small muted' }, `${KNIFE_TEXT}.`));
      return;
    }
    if (locked) body.appendChild(h('p', { class: 'small muted' }, 'Тоглолт баталгаажсан — хасалтыг өөрчлөхгүй.'));

    // who bans first
    if (!ko) {
      body.appendChild(h('p', { class: 'small' }, 'Эхэлж хасах баг: ', h('b', {}, nameA), ' (эхэнд бичигдсэн баг).'));
    } else {
      const how = v.coin ? ' (зоосоор)' : ' (гараар сонгосон)';
      body.appendChild(h('p', { class: 'small' }, v.started ? 'Эхэлж хассан: ' : 'Эхэлж хасах баг: ',
        v.first ? h('b', {}, nm(v.first)) : h('b', { class: 'adm-warn-text' }, 'тогтоогоогүй — зоос шиднэ үү'), v.first ? how : null));
      if (!v.started && !locked) {
        body.appendChild(h('div', { class: 'row adm-veto-coin' },
          act(v.first ? 'Зоос дахин шидэх' : 'Зоос шидэх', async () => {
            if (v.first) {
              const ok = await confirmDialog({ title: `№${no} — зоосыг дахин шидэх үү?`, text: `Одоо: ${nm(v.first)} эхэлж хасна.`, ok: 'Дахин шидэх' });
              if (!ok) return;
            }
            await send('first', { side: 'coin', step: 0 }, (r) => `Зоос: ${nm(r.match && r.match.veto_first)} эхэлж хасна`);
          }, 'gold', { disabled: !can }),
          ['a', 'b'].map((side) => act(`${nm(side)} эхэлнэ`, () => send('first', { side, step: 0 }, `${nm(side)} эхэлж хасна`),
            'secondary', { disabled: !can || v.first === side, pressed: v.first === side }))));
      }
    }

    const bo3 = v.bo === 3;
    const acts = Array.isArray(v.acts) ? v.acts : [];
    const isPick = v.nextAct === 'pick';
    const picksBefore = (i) => acts.slice(0, i).filter((a) => a === 'pick').length;   // picks before step i
    if (v.next) {
      body.appendChild(h('p', { class: 'adm-veto-turn' }, `Алхам ${v.next.step + 1}/${v.total}: `, h('b', {}, nm(v.next.side)),
        isPick ? ` сонгоно (${picksBefore(v.next.step) + 1}-р газар)` : ' хасна'));
    }
    const games = Array.isArray(m.games) ? m.games : [];
    if (bo3 && games.length && !locked) {
      body.appendChild(h('p', { class: 'small adm-warn-text' }, `Анхаар: ${games.length} газрын оноо орсон — хасалтыг өөрчилбөл газрын зураг солигдоно.`));
    }

    // map buttons: banned (struck, team label), picked (Bo3 1-р/2-р газар), decided (green / Bo3 decider), selectable
    const grid = h('div', { class: 'adm-maps', role: 'group', 'aria-label': `№${no} газрын зургууд` });
    const stepOf = new Map(v.steps.map((x, i) => [x.map, i]));
    const decider = bo3 && v.done ? v.remaining[0] : null;
    for (const key of pool) {
      const info = mapInfo(key);
      const i = stepOf.has(key) ? stepOf.get(key) : -1;
      const pick = !bo3 && v.done && v.map === key;
      let sub = '';
      let cls = 'adm-map';
      let label = info.name;
      if (i >= 0 && acts[i] === 'pick') {
        const n = picksBefore(i) + 1;
        cls += ' is-pick'; sub = `${n}-р газар · ${nm(v.steps[i].side)}`; label = `${info.name} — ${n}-р газар, ${nm(v.steps[i].side)} сонгосон`;
      } else if (i >= 0) {
        cls += ' is-banned'; sub = `${i + 1}. ${nm(v.steps[i].side)}`; label = `${info.name} — ${i + 1}-р хасалт, ${nm(v.steps[i].side)}`;
      } else if (decider === key) {
        cls += ' is-decider'; sub = '3-р газар · шийдвэрлэх'; label = `${info.name} — 3-р газар (шийдвэрлэх)`;
      } else if (pick) { cls += ' is-pick'; sub = 'Тоглоно'; label = `${info.name} — тоглох газрын зураг`; }
      const selectable = can && i < 0 && !!v.next;
      const b = h('button', {
        type: 'button', class: cls, disabled: !selectable, 'aria-pressed': selectable ? String(sel === key) : null, 'aria-label': label,
      }, h('span', { class: 'adm-map-n' }, info.name), sub ? h('span', { class: 'adm-map-s' }, sub) : null);
      b.addEventListener('click', () => {
        if (inFlight || b.disabled) return;
        if (sel === key) sels.delete(no); else sels.set(no, { map: key, step: v.steps.length });
        paint();
        const next = box.querySelector(sels.has(no) ? '.adm-veto-ban' : `.adm-map[data-key="${key}"]`);
        if (next) next.focus();
      });
      b.dataset.key = key;
      grid.appendChild(b);
    }
    body.appendChild(grid);

    if (sel && v.next) {
      const name = mapInfo(sel).name;
      body.appendChild(h('div', { class: 'row adm-veto-confirm' },
        act(`${name} ${isPick ? 'сонгох' : 'хасах'}`,
          () => send(isPick ? 'pick' : 'ban', { map: sel, step: v.steps.length }, `${nm(v.next.side)}: ${name} ${isPick ? 'сонголоо' : 'хаслаа'}`),
          isPick ? 'adm-veto-ban gold' : 'adm-veto-ban', { disabled: !can }),
        act('Болих', () => { sels.delete(no); paint(); }, 'secondary')));
    } else if (v.next && can) {
      body.appendChild(h('p', { class: 'small muted' }, `${isPick ? 'Тоглох' : 'Хасах'} газрын зургийг сонгоод баталгаажуулна уу.`));
    }

    const copyRow = (text, cls, { disabled = false, label = null } = {}) => {
      const copyBtn = h('button', { type: 'button', class: 'btn secondary small-btn', disabled, 'aria-label': `Хуулах: ${label || text}` }, 'Хуулах');
      copyBtn.addEventListener('click', () => { if (!copyBtn.disabled) copyText(text); });
      return h('div', { class: `adm-veto-cmd ${cls}` }, text.includes('\n') ? h('pre', { class: 'adm-mono' }, text) : h('code', { class: 'adm-mono' }, text), copyBtn);
    };
    const mapKey = v.map || (typeof m.map === 'string' && m.map ? m.map : null);
    const maps = bo3 && v.done && Array.isArray(v.maps) ? v.maps.filter((k) => typeof k === 'string' && k) : [];
    if (bo3 && maps.length === 3) {
      body.appendChild(seriesDone(maps, v.first));
    } else if (bo3) {
      body.appendChild(h('p', { class: 'small muted' }, 'Bo3: хасах, хасах, сонгох, сонгох, хасах, хасах — үлдсэн нь 3-р газар (шийдвэрлэх). '
        + 'Дуусахад MatchZy JSON-ий мөрүүд энд гарна.'));
    } else if (v.done && mapKey) {
      // main: the match JSON line (MatchZy loads maplist[0]); changelevel only for a JSON that is already loaded
      body.appendChild(h('div', { class: 'adm-veto-done' },
        h('p', {}, 'Тоглох газрын зураг: ', h('b', {}, mapInfo(mapKey).name)),
        h('p', { class: 'small' }, 'Техникийн ахлагч match JSON-д энэ мөрийг засаад matchzy_loadmatch ажиллуулна:'),
        copyRow(maplistLine(mapKey), 'is-json'),
        h('p', { class: 'small' }, 'JSON-ыг аль хэдийн ачаалсан бол консолд ', h('b', {}, '(зөвхөн LIVE болохоос өмнө)'), ':'),
        copyRow(serverCommand(mapKey), 'is-alt'),
        h('p', { class: 'small' }, h('b', {}, `${KNIFE_TEXT}.`))));
    } else {
      body.appendChild(h('p', { class: 'small muted' }, `${KNIFE_TEXT}. Хасалт дуусахад match JSON-ий maplist мөр энд гарна.`));
    }

    /** Bo3 done: 3 maps, the two side choices (page only), MatchZy series lines, per-map changelevel fallback. */
    function seriesDone(list, first) {
      const cur = sides.get(no) || {};
      const { lines, complete } = seriesJsonLines(list.map((k) => mapInfo(k).id), first, cur);
      const sideRow = (game) => {
        const chooser = sideChooser(first, game);
        const s = h('select', { 'aria-label': `${game}-р газар: ${nm(chooser)} эхлэх тал` },
          h('option', { value: '' }, 'Сонгоогүй'), h('option', { value: 'ct' }, 'CT-ээс эхэлнэ'), h('option', { value: 't' }, 'T-ээс эхэлнэ'));
        s.value = cur[game] === 'ct' || cur[game] === 't' ? cur[game] : '';
        s.dataset.game = String(game);
        s.addEventListener('change', () => {
          sides.set(no, { ...(sides.get(no) || {}), [game]: s.value });
          paint();
          const again = box.querySelector(`select[data-game="${game}"]`);
          if (again) again.focus();
        });
        return h('label', { class: 'adm-side' },
          h('span', {}, `${game}-р газар (${mapInfo(list[game - 1]).name}): `, h('b', {}, nm(chooser)), ' талаа сонгоно'), s);
      };
      return h('div', { class: 'adm-veto-done' },
        h('p', {}, 'Тоглох газрын зургууд (Bo3): ',
          h('b', {}, list.map((k, i) => `${i + 1}. ${mapInfo(k).name}`).join(' · ')), ' — 3-р газар шийдвэрлэх.'),
        h('div', { class: 'adm-sides' }, sideRow(1), sideRow(2),
          h('p', { class: 'small' }, `3-р газар (${mapInfo(list[2]).name}): `, h('b', {}, `${KNIFE_TEXT}.`))),
        h('p', { class: 'small' }, 'Техникийн ахлагч final_A.json (3-р байр: 3-r-bair_B.json) дахь num_maps, maplist, map_sides, clinch_series мөрүүдийг '
          + 'эдгээрээр солиод (давхар бүү үлдээ) matchzy_loadmatch ажиллуулна:'),
        copyRow(lines.join('\n'), 'is-json', { disabled: !complete, label: 'MatchZy Bo3 мөрүүд' }),
        complete ? null : h('p', { class: 'small adm-warn-text' }, '1, 2-р газрын талыг сонгосны дараа хуулна (таамаглахгүй).'),
        h('p', { class: 'small' }, 'MatchZy цуврал ачаалагдахгүй бол газар бүрийн өмнө консолд, дараа нь exec tournament_knockout_mr12 '
          + '(3-р газарт хутганы раунд). matchzy_loadmatch-ийг газар явагдаж байхад бүү ажиллуул:'),
        list.map((k, i) => copyRow(serverCommand(k), 'is-alt', { label: `${i + 1}-р газар ${serverCommand(k)}` })));
    }

    if (!locked) {
      const last = v.steps[v.steps.length - 1];
      body.appendChild(h('div', { class: 'row adm-veto-act' },
        act('Буцаах', () => send('undo', { step: v.steps.length }, last ? `Буцаалаа: ${mapInfo(last.map).name}` : 'Буцаалаа'), 'secondary', { disabled: !can || !v.started }),
        act('Шинээр эхлүүлэх', async () => {
          const ok = await confirmDialog({
            title: `№${no} — хасалтыг шинээр эхлүүлэх үү?`,
            text: [`${v.steps.length} ${bo3 ? 'алхам' : 'хасалт'}${ko && m.veto_first ? ', зоосны үр дүн' : ''} устна.`, 'Багуудад мэдэгдээд дахин эхлүүлнэ үү.'],
            ok: 'Шинээр эхлүүлэх',
            danger: true,
          });
          if (ok) await send('reset', { step: v.steps.length }, `№${no}: хасалтыг шинээр эхлүүллээ`);
        }, 'secondary adm-btn-danger', { disabled: !can || !(v.started || (ko && m.veto_first)) })));
    }
  }

  paint();
  return box;
}
