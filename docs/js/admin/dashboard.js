// 1. Самбар — 12 багийн төлөв, хугацаа, шүүлтүүр, CSV/JSON татах.
import { h, toast, fmtDateTime, fmtCountdown } from '../ui.js';
import { btn, section, chip, download } from './core.js';
import { toCsv, fileStamp, isFuture, matchzyWithAliases, consentRowsWithAliases, mntText } from './util.js';
import { DATES, FEE } from '../event.js';

const nPlayers = (t) => (Array.isArray(t.players) ? t.players.length : Number((t.reg && t.reg.players) || 0));
const nConsents = (t) => (Array.isArray(t.players) ? t.players.filter((p) => p.consent_paper === true).length : Number((t.reg && t.reg.consents) || 0));
const isConfirmed = (t) => !!(t.confirmed_at || (t.reg && t.reg.confirmed === true));

const FILTERS = [
  ['all', 'Бүгд', () => true],
  ['unconfirmed', 'Батлаагүй', (t) => !isConfirmed(t)],
  ['incomplete', 'Бүрэлдэхүүн дутуу', (t) => nPlayers(t) < 5],
  ['consent', 'Зөвшөөрөл дутуу', (t) => nPlayers(t) === 0 || nConsents(t) < nPlayers(t)],
  ['notoken', 'QR олгоогүй', (t) => !t.has_token],
  ['locked', 'Түгжээтэй', (t) => !!t.locked || isFuture(t.pin_locked_until) || !!t.pin_hard_locked],
];

const EXPORTS = [
  ['roster', 'Бүртгэл (CSV)'],
  ['consent', 'Зөвшөөрөл (CSV)'],
  ['results', 'Үр дүн (CSV)'],
  ['matchzy', 'MatchZy (JSON)'],
];

function tile(label, value, sub) {
  return h('div', { class: 'adm-tile' }, h('div', { class: 'adm-tile-v' }, value), h('div', { class: 'adm-tile-l' }, label), sub ? h('div', { class: 'muted small' }, sub) : null);
}

function deadlineRow(label, iso) {
  if (!iso) return null;
  const left = Date.parse(iso) - Date.now();
  return h('div', { class: 'adm-deadline' },
    h('span', { class: 'adm-deadline-l' }, label),
    h('span', {}, fmtDateTime(iso)),
    left > 0 ? chip(`${fmtCountdown(left)} үлдлээ`, left < 86400000 ? 'warn' : '') : chip('Дууссан', 'err'));
}

function line(label, value, kind = '') {
  return h('div', { class: `adm-line ${kind}`.trim() }, h('span', { class: 'muted' }, label), h('b', {}, value));
}

function teamCard(ctx, t) {
  const n = nPlayers(t);
  const c = nConsents(t);
  const conf = isConfirmed(t);
  return h('article', { class: `adm-team ${conf ? 'is-ok' : ''}` },
    h('header', {}, h('h3', {}, t.name), chip(t.is_teachers ? 'Багш нар' : `${t.pot}-р сагс`)),
    line('Тоглогч', `${n}/6`, n >= 5 ? 'ok' : 'bad'),
    line('Баталгаа', conf ? (t.confirmed_at ? `✓ ${fmtDateTime(t.confirmed_at)}` : '✓') : 'Батлаагүй', conf ? 'ok' : 'bad'),
    line('Зөвшөөрөл (05)', `${c}/${n || 6}`, n > 0 && c >= n ? 'ok' : 'bad'),
    line('QR', t.has_token ? 'Олгосон' : 'Олгоогүй', t.has_token ? 'ok' : 'bad'),
    t.locked ? line('Бүртгэл', 'Түгжээтэй', 'bad') : null,
    isFuture(t.unlocked_until) ? line('Засвар нээлттэй', `${fmtDateTime(t.unlocked_until)} хүртэл`) : null,
    isFuture(t.pin_locked_until) ? line('PIN түгжээ', `${fmtDateTime(t.pin_locked_until)} хүртэл`, 'bad') : null,
    t.pin_hard_locked ? line('PIN', 'Бүрмөсөн түгжигдсэн', 'bad') : null,
    h('footer', { class: 'row' },
      btn('Бүртгэл', () => ctx.go('roster', { teamId: t.id }), 'secondary small-btn'),
      btn('Зөвшөөрөл', () => ctx.go('consent', { team: String(t.id) }), 'secondary small-btn')));
}

async function doExport(ctx, kind) {
  const r = await ctx.call('export', { kind });
  if (!r.ok) return;
  // Game feed names: the server export uses row 3б only; the hall projector (3а) shows the same feed,
  // so streamName() needs BOTH 3а and 3б «Тийм» (fresh ticks/aliases from the overview).
  let teams = ctx.state.teams;
  if (kind === 'matchzy' || kind === 'consent') {
    const ov = await ctx.call('overview', {}, { quiet: true });
    if (ov.ok && Array.isArray(ov.teams)) teams = ov.teams;
  }
  if (kind === 'matchzy') {
    download(`cs2_matchzy_${fileStamp()}.json`, `${JSON.stringify({ teams: matchzyWithAliases(r.teams || {}, teams) }, null, 2)}\n`, 'application/json;charset=utf-8');
    const miss = Array.isArray(r.missing) ? r.missing.length : 0;
    if (miss) toast(`${miss} тоглогчийн SteamID64 дутуу — файлд ороогүй.`, 'warn', 6000);
  } else {
    const rows = kind === 'consent' ? consentRowsWithAliases(r.columns, r.rows, teams) : r.rows;
    download(`cs2_${kind}_${fileStamp()}.csv`, toCsv(r.columns, rows), 'text/csv;charset=utf-8');
  }
  toast('Файл татлаа', 'ok');
}

export function render(panel, ctx, ui) {
  const st = ctx.state;
  const teams = ctx.teams();
  const S = st.settings || {};
  if (!FILTERS.some((f) => f[0] === ui.filter)) ui.filter = 'all';

  const totalP = teams.reduce((s, t) => s + nPlayers(t), 0);
  const totalC = teams.reduce((s, t) => s + nConsents(t), 0);
  const conf = teams.filter(isConfirmed).length;
  const tok = teams.filter((t) => t.has_token).length;

  panel.appendChild(h('div', { class: 'adm-tiles' },
    tile('Баталгаажсан баг', `${conf}/${teams.length}`),
    tile('Тоглогч', `${totalP}/${teams.length * 6}`),
    tile('Зөвшөөрөл (05)', `${totalC}/${totalP || teams.length * 6}`),
    tile('QR олгосон', `${tok}/${teams.length}`)));

  // SPEC v5 §2, §2a: the draw (10.22) does not freeze rosters; registration closes = roster freeze (10.23 23:59).
  const sameClose = !!S.reg_closes_at && Date.parse(S.reg_closes_at) === Date.parse(S.roster_freeze_at || '');
  panel.appendChild(section('Хугацаа',
    h('div', { class: 'row' }, chip(S.registration_open === false ? 'Бүртгэл хаалттай' : 'Бүртгэл нээлттэй', S.registration_open === false ? 'err' : 'ok')),
    deadlineRow('Сугалаа (техникийн зөвлөгөөн)', DATES.draw_at),
    deadlineRow('Зөвшөөрөл (05, 05б), маягт 04', S.consent_deadline_at),
    deadlineRow('Багийн хураамж (нягтлан бодогч)', DATES.fee_due_at),
    sameClose
      ? deadlineRow('Бүртгэл хаагдах, бүрэлдэхүүн царцах', S.reg_closes_at)
      : [deadlineRow('Бүртгэл хаагдах', S.reg_closes_at), deadlineRow('Бүрэлдэхүүн царцах', S.roster_freeze_at)],
    h('p', { class: 'muted small adm-mt' }, `Хураамж ${mntText(FEE.team)} / ангийн баг (Багш нарын баг төлөхгүй). Төлбөрийн бүртгэлийг Excel 08 «Багууд»-д хөтөлж, төлсөн ангиудыг «Зарлал»-аар нийтэлнэ.`)));

  const grid = h('div', { class: 'adm-teams' });
  const fill = () => {
    grid.textContent = '';
    const f = FILTERS.find((x) => x[0] === ui.filter) || FILTERS[0];
    const list = teams.filter(f[2]);
    if (!list.length) grid.appendChild(h('p', { class: 'muted' }, 'Энэ шүүлтүүрт баг алга.'));
    for (const t of list) grid.appendChild(teamCard(ctx, t));
  };
  const filterBar = h('div', { class: 'adm-filters', role: 'group', 'aria-label': 'Шүүлтүүр' },
    FILTERS.map(([key, label, fn]) => {
      const b = h('button', {
        type: 'button', class: 'adm-filter', 'aria-pressed': String(ui.filter === key),
      }, `${label} (${teams.filter(fn).length})`);
      b.addEventListener('click', () => {
        ui.filter = key;
        for (const x of filterBar.children) x.setAttribute('aria-pressed', String(x === b));
        fill();
      });
      return b;
    }));
  fill();
  panel.appendChild(h('section', { class: 'adm-sec-plain' }, h('h2', {}, 'Багууд'), filterBar, grid));

  const hidden = st.teams.filter((t) => !teams.includes(t));
  if (hidden.length) {
    panel.appendChild(h('p', { class: 'muted small' }, `Далд тест баг: ${hidden.map((t) => t.name).join(', ')} (нийтэд харагдахгүй, тоонд орохгүй).`));
  }

  panel.appendChild(section('Татах',
    h('div', { class: 'row' }, EXPORTS.map(([kind, label]) => btn(label, () => doExport(ctx, kind), 'secondary'))),
    h('p', { class: 'muted small' }, 'Файлд хувийн мэдээлэл бий. Ажил дуусмагц компьютерээсээ устгана уу.')));
}
