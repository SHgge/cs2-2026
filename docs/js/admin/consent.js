// 3. Зөвшөөрөл — 72 мөрийн хүснэгт: 05 / 3а / 3б / 3в тэмдэглэгээ, хоч нэр, автомат хоч нэр.
import { h, toast } from '../ui.js';
import { btn, section, chip, confirmDialog } from './core.js';
import { needsAlias, autoAliasPlan, playerId } from './util.js';

const COLS = [
  ['consent_paper', '05', 'Эцэг эхийн зөвшөөрөл (маягт 05)'],
  ['consent_3a', '3а', 'Танхимын проектор'],
  ['consent_3b', '3б', 'Онлайн шууд дамжуулалт'],
  ['consent_3v', '3в', 'Тайлбарлагчийн дуу'],
];
const SHOW = [
  ['all', 'Бүгд'],
  ['no05', '05 дутуу'],
  ['alias', 'Хоч нэр хэрэгтэй'],
];

export function render(panel, ctx, ui) {
  const teams = ctx.teams();
  if (!ui.team) ui.team = 'all';
  if (!SHOW.some((s) => s[0] === ui.show)) ui.show = 'all';
  const all = [];
  for (const t of teams) for (const p of t.players || []) all.push({ t, p });

  const counts = h('div', { class: 'adm-counts', 'aria-live': 'polite' });
  const updateCounts = () => {
    const n = all.length;
    const c = (k) => all.filter((r) => r.p[k] === true).length;
    const need = all.filter((r) => needsAlias(r.p));
    const missing = need.filter((r) => !String(r.p.alias || '').trim()).length;
    counts.textContent = '';
    counts.append(
      chip(`05: ${c('consent_paper')}/${n}`, c('consent_paper') === n && n ? 'ok' : 'warn'),
      chip(`3а Тийм: ${c('consent_3a')}`),
      chip(`3б Тийм: ${c('consent_3b')}`),
      chip(`3в Тийм: ${c('consent_3v')}`),
      chip(`Хоч нэр хэрэгтэй: ${need.length}${missing ? `, дутуу ${missing}` : ''}`, missing ? 'warn' : 'ok'));
  };

  const teamSel = h('select', { 'aria-label': 'Баг' },
    h('option', { value: 'all' }, 'Бүх баг'),
    teams.map((t) => h('option', { value: String(t.id) }, t.name)));
  teamSel.value = String(ui.team);
  const showSel = h('select', { 'aria-label': 'Харуулах' }, SHOW.map(([v, l]) => h('option', { value: v }, l)));
  showSel.value = ui.show;

  const tbody = h('tbody');
  const fill = () => {
    tbody.textContent = '';
    const rows = all.filter((r) => (ui.team === 'all' || String(r.t.id) === String(ui.team))
      && (ui.show === 'all'
        || (ui.show === 'no05' && r.p.consent_paper !== true)
        || (ui.show === 'alias' && needsAlias(r.p))));
    if (!rows.length) {
      tbody.appendChild(h('tr', {}, h('td', { colspan: 9, class: 'muted center' }, all.length ? 'Энэ шүүлтүүрт тоглогч алга.' : 'Тоглогч бүртгэгдээгүй байна.')));
      return;
    }
    for (const r of rows) tbody.appendChild(row(ctx, r, updateCounts));
  };
  teamSel.addEventListener('change', () => { ui.team = teamSel.value; fill(); });
  showSel.addEventListener('change', () => { ui.show = showSel.value; fill(); });

  const progress = h('span', { class: 'muted small', 'aria-live': 'polite' });
  const autoBtn = btn('Хоч нэр автоматаар', async () => {
    const plan = autoAliasPlan(teams);
    if (!plan.length) { toast('Хоч нэр өгөх шинэ тоглогч алга.', 'ok'); return; }
    const ok = await confirmDialog({
      title: 'Хоч нэр автоматаар өгөх үү?',
      text: [`${plan.length} тоглогчид хоч нэр өгнө. Жишээ: «${plan[0].alias}».`, '3а эсвэл 3б «Тийм» биш, хоч нэргүй тоглогчдод л өгнө. Өмнө бичсэн хоч нэр өөрчлөгдөхгүй.'],
      ok: 'Өгөх',
    });
    if (!ok) return;
    let done = 0;
    let failed = 0;
    for (const item of plan) {
      const r = await ctx.call('consent_set', { player_id: item.player_id, alias: item.alias }, { quiet: true });
      if (r.error === 'bad_session') return;
      if (r.ok) done += 1; else failed += 1;
      progress.textContent = `${done + failed}/${plan.length}`;
    }
    progress.textContent = '';
    toast(failed ? `${done} хоч нэр өглөө, ${failed} алдаа гарлаа.` : `${done} тоглогчид хоч нэр өглөө.`, failed ? 'warn' : 'ok', 5000);
    await ctx.reload();
  }, 'gold');

  panel.appendChild(section('Зөвшөөрөл',
    h('p', { class: 'muted small' }, 'Цаасан маягтыг шалгаад тэмдэглэнэ үү. 05 — эцэг эхийн зөвшөөрөл; 3а — танхимын проектор; 3б — онлайн дамжуулалт; 3в — тайлбарлагчийн дуу. Тэмдэглэх бүрт шууд хадгална.'),
    h('p', { class: 'muted small' }, '3а эсвэл 3б «Тийм» биш тоглогч дэлгэц, дамжуулалтад зөвхөн хоч нэрээр харагдана.'),
    counts,
    h('div', { class: 'row adm-mt' }, teamSel, showSel, h('span', { class: 'spacer' }), autoBtn, progress)));

  panel.appendChild(h('div', { class: 'table-scroll adm-grid-wrap' },
    h('table', { class: 'tbl adm-consent' },
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'Баг'), h('th', { scope: 'col' }, '№'), h('th', { scope: 'col' }, 'Нэр'), h('th', { scope: 'col' }, 'Steam нэр'),
        COLS.map(([, label, title]) => h('th', { scope: 'col', class: 'center', title }, label)),
        h('th', { scope: 'col' }, 'Хоч нэр'))),
      tbody)));
  updateCounts();
  fill();
}

function row(ctx, r, updateCounts) {
  const { t, p } = r;
  const pid = playerId(p);
  const tr = h('tr', {});
  const alias = h('input', { type: 'text', maxlength: 32, autocomplete: 'off', spellcheck: 'false', 'aria-label': `${t.name} ${p.slot}-р тоглогчийн хоч нэр`, class: 'adm-alias' });
  alias.value = p.alias || '';
  const mark = () => {
    const need = needsAlias(p) && !String(p.alias || '').trim();
    tr.classList.toggle('need-alias', need);
    alias.placeholder = needsAlias(p) ? 'Хоч нэр хэрэгтэй' : '';
  };
  tr.append(
    h('td', {}, t.name),
    h('td', {}, p.slot === 6 ? '6 (нөөц)' : String(p.slot)),
    h('td', {}, `${p.first_name || ''} ${p.surname_initial ? `${p.surname_initial}.` : ''}`.trim()),
    h('td', { class: 'adm-steam' }, p.steam_nickname || ''));
  for (const [key, label] of COLS) {
    const cb = h('input', { type: 'checkbox', 'aria-label': `${t.name} ${p.slot}: ${label}` });
    cb.checked = p[key] === true;
    cb.addEventListener('change', async () => {
      const val = cb.checked;
      cb.disabled = true;
      const res = await ctx.call('consent_set', { player_id: pid, [key]: val });
      cb.disabled = false;
      if (res.ok) { p[key] = val; mark(); updateCounts(); ctx.softReload(); } else cb.checked = !val;
    });
    tr.appendChild(h('td', { class: 'adm-tog' }, h('label', { class: 'adm-tog-l' }, cb)));
  }
  alias.addEventListener('change', async () => {
    const v = alias.value.trim();
    if (v && [...v].length < 2) { toast('Хоч нэр 2–32 тэмдэгт байна.', 'err'); alias.value = p.alias || ''; return; }
    alias.disabled = true;
    const res = await ctx.call('consent_set', { player_id: pid, alias: v || null });
    alias.disabled = false;
    if (res.ok) { p.alias = v; mark(); updateCounts(); ctx.softReload(); toast('Хоч нэр хадгаллаа', 'ok', 1500); } else alias.value = p.alias || '';
  });
  tr.appendChild(h('td', {}, alias));
  mark();
  return tr;
}
