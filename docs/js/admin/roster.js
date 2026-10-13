// 2. Бүртгэл — багийн бүрэлдэхүүн харах/засах, баталгаа цуцлах, багшийн өмнөөс батлах, түгжих, засвар түр нээх.
import { h, toast, fmtDateTime } from '../ui.js';
import { btn, section, chip, confirmDialog } from './core.js';
import {
  rosterCheck, isBlankPlayer, fieldErrorText, isoToLocalInput, localInputToIso, isFuture, playerId,
} from './util.js';

const FIELDS = [
  { key: 'first_name', label: 'Нэр', attrs: { maxlength: 30 } },
  { key: 'surname_initial', label: 'Овгийн үсэг', attrs: { maxlength: 2, class: 'adm-in-xs' } },
  { key: 'steam_nickname', label: 'Steam нэр', attrs: { maxlength: 32 } },
  { key: 'steam_id64', label: 'Steam64 ID', attrs: { maxlength: 17, inputmode: 'numeric', class: 'adm-in-id' } },
];

function defaultUntil() {
  const d = new Date(Date.now() + 2 * 3600 * 1000);
  d.setUTCMinutes(0, 0, 0);
  return isoToLocalInput(d.toISOString());
}

function statusChips(t) {
  return h('div', { class: 'row' },
    t.confirmed_at ? chip(`Батлагдсан · ${fmtDateTime(t.confirmed_at)}${String(t.confirmed_by || '').startsWith('admin') ? ' (админ)' : ''}`, 'ok') : chip('Батлаагүй', 'warn'),
    t.locked ? chip('Түгжээтэй', 'err') : null,
    isFuture(t.unlocked_until) ? chip(`Засвар нээлттэй · ${fmtDateTime(t.unlocked_until)} хүртэл`, 'gold') : null,
    isFuture(t.pin_locked_until) ? chip(`PIN түгжээтэй · ${fmtDateTime(t.pin_locked_until)} хүртэл`, 'err') : null,
    t.pin_hard_locked ? chip('PIN бүрмөсөн түгжигдсэн — «Эрх, хэвлэх» хэсэгт PIN шинэчилнэ үү', 'err') : null,
    t.has_pin === false ? chip('PIN олгоогүй', 'warn') : null,
    t.has_token ? null : chip('QR олгоогүй', 'warn'),
    t.is_hidden || t.code === 'test' ? chip('Далд тест баг') : null);
}

function actions(ctx, t) {
  const box = h('div', { class: 'row adm-actions' });
  if (t.confirmed_at) {
    box.appendChild(btn('Баталгааг цуцлах', async () => {
      const ok = await confirmDialog({
        title: `${t.name} — баталгааг цуцлах уу?`, text: 'Багш дахин PIN-ээр батлах шаардлагатай болно.', ok: 'Цуцлах', danger: true,
      });
      if (ok) await ctx.act('team_unconfirm', { team_id: t.id }, 'Баталгааг цуцаллаа');
    }, 'secondary'));
  } else {
    box.appendChild(btn('Багшийн өмнөөс батлах', async () => {
      const ps = t.players || [];
      const warn = [];
      if (ps.length < 5) warn.push('5-аас цөөн тоглогчтой байна.');
      if (ps.filter((p) => p.is_captain).length !== 1) warn.push('Ахлагч яг нэг байх ёстой.');
      if (ps.some((p) => p.age13 !== true)) warn.push('13 нас хүрснийг бүгдэд тэмдэглээгүй байна.');
      const reason = await confirmDialog({
        title: `${t.name} — багшийн өмнөөс батлах уу?`,
        text: [...warn, 'Шалтгааныг бичнэ үү. Үйлдлийн бүртгэлд хадгалагдана.'],
        ok: 'Батлах',
        input: { label: 'Шалтгаан', required: true, min: 5, placeholder: 'Жишээ: Багш утсаар зөвшөөрсөн' },
      });
      if (reason) await ctx.act('confirm_on_behalf', { team_id: t.id, reason }, 'Баталлаа');
    }, 'secondary'));
  }
  box.appendChild(btn(t.locked ? 'Түгжээг тайлах' : 'Түгжих', async () => {
    const ok = await confirmDialog(t.locked
      ? { title: `${t.name} — түгжээг тайлах уу?`, text: 'Бүртгэлийн хугацаанд анги дахин засах боломжтой болно.', ok: 'Тайлах' }
      : { title: `${t.name} — бүртгэлийг түгжих үү?`, text: 'Анги, багш засвар хийх боломжгүй болно.', ok: 'Түгжих', danger: true });
    if (ok) await ctx.act('lock', { team_id: t.id, locked: !t.locked }, t.locked ? 'Түгжээг тайллаа' : 'Түгжлээ');
  }, t.locked ? '' : 'secondary'));

  const until = h('input', { type: 'datetime-local', step: 300, 'aria-label': 'Засвар нээлттэй байх хугацаа' });
  until.value = isFuture(t.unlocked_until) ? isoToLocalInput(t.unlocked_until) : defaultUntil();
  const unlockBox = h('div', { class: 'adm-inline' },
    h('span', { class: 'muted small' }, 'Хугацаа дууссан ч засвар түр нээх:'),
    until,
    btn('хүртэл нээх', async () => {
      const iso = localInputToIso(until.value);
      if (!iso || !isFuture(iso)) { toast('Ирээдүйн цаг сонгоно уу.', 'err'); return; }
      await ctx.act('unlock_until', { team_id: t.id, until: iso }, 'Засвар түр нээлээ');
    }, 'secondary'),
    isFuture(t.unlocked_until) ? btn('Хаах', () => ctx.act('unlock_until', { team_id: t.id, until: null }, 'Түр нээлтийг хаалаа'), 'secondary') : null);
  return h('div', {}, box, unlockBox);
}

function editor(ctx, t) {
  const rows = [];
  const tbody = h('tbody');
  for (let slot = 1; slot <= 6; slot += 1) {
    const p = (t.players || []).find((x) => x.slot === slot) || {};
    const cells = {};
    const errs = {};
    const tr = h('tr', { dataset: { slot: String(slot) } });
    tr.appendChild(h('th', { scope: 'row', class: 'adm-slot' }, slot === 6 ? '6 · Нөөц' : String(slot)));
    for (const f of FIELDS) {
      const inp = h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-label': `${slot}-р тоглогч: ${f.label}`, ...f.attrs });
      inp.value = p[f.key] == null ? '' : String(p[f.key]);
      inp.addEventListener('input', () => { ctx.setDirty(true); inp.classList.remove('input-error'); errs[f.key].textContent = ''; });
      cells[f.key] = inp;
      errs[f.key] = h('div', { class: 'field-error' });
      tr.appendChild(h('td', {}, inp, errs[f.key]));
    }
    const cap = h('input', { type: 'checkbox', 'aria-label': `${slot}-р тоглогч ахлагч` });
    cap.checked = p.is_captain === true;
    cap.addEventListener('change', () => {
      ctx.setDirty(true);
      if (cap.checked) for (const r of rows) if (r.cap !== cap) r.cap.checked = false;
    });
    const age = h('input', { type: 'checkbox', 'aria-label': `${slot}-р тоглогч 13 нас хүрсэн` });
    age.checked = p.age13 === true;
    age.addEventListener('change', () => ctx.setDirty(true));
    errs.is_captain = h('div', { class: 'field-error' });
    tr.appendChild(h('td', { class: 'adm-tog' }, h('label', { class: 'adm-tog-l' }, cap), errs.is_captain));
    tr.appendChild(h('td', { class: 'adm-tog' }, h('label', { class: 'adm-tog-l' }, age)));
    tr.appendChild(h('td', { class: 'adm-tog small' }, p.consent_paper === true ? chip('05 ✓', 'ok') : h('span', { class: 'muted' }, '—')));
    const clr = h('button', { type: 'button', class: 'adm-x', 'aria-label': `${slot}-р мөрийг арилгах`, title: 'Мөр арилгах' }, '×');
    clr.addEventListener('click', () => {
      for (const f of FIELDS) { cells[f.key].value = ''; cells[f.key].classList.remove('input-error'); errs[f.key].textContent = ''; }
      cap.checked = false;
      age.checked = false;
      ctx.setDirty(true);
    });
    tr.appendChild(h('td', {}, clr));
    tbody.appendChild(tr);
    rows.push({ slot, p, cells, errs, cap, age });
  }

  const summary = h('p', { class: 'field-error', role: 'alert' });
  const showErrors = (list) => {
    for (const r of rows) for (const k of Object.keys(r.errs)) { r.errs[k].textContent = ''; if (r.cells[k]) r.cells[k].classList.remove('input-error'); }
    for (const e of list || []) {
      const r = rows.find((x) => x.slot === e.slot);
      if (!r || !r.errs[e.field]) continue;
      r.errs[e.field].textContent = fieldErrorText(e.field, e.code);
      if (r.cells[e.field]) r.cells[e.field].classList.add('input-error');
    }
    summary.textContent = list && list.length ? 'Улаан талбаруудыг засна уу.' : '';
  };

  const save = btn('Хадгалах', async () => {
    const players = rows.map((r) => ({
      slot: r.slot,
      first_name: r.cells.first_name.value.trim(),
      surname_initial: r.cells.surname_initial.value.trim(),
      steam_nickname: r.cells.steam_nickname.value.trim(),
      steam_id64: r.cells.steam_id64.value.trim() || null,
      is_captain: r.cap.checked,
      age13: r.age.checked,
      _id: playerId(r.p),
    })).filter((p) => !isBlankPlayer(p) || p.is_captain);
    const chk = rosterCheck(players);
    showErrors(chk.errors);
    if (chk.errors.length) { toast('Алдаатай талбарыг засна уу.', 'err'); return; }
    if (players.length < 5) {
      const ok = await confirmDialog({ title: 'Тоглогч 5-аас цөөн байна', text: 'Батлахад 5–6 тоглогч хэрэгтэй. Одоогийнхоор хадгалах уу?', ok: 'Хадгалах' });
      if (!ok) return;
    }
    const payload = players.map(({ _id, ...p }) => (_id != null ? { id: _id, ...p } : p));
    const r = await ctx.call('team_save', { team_id: t.id, players: payload, expected_version: t.version });
    if (r.ok) {
      toast(t.confirmed_at ? 'Хадгаллаа. Баталгаа цуцлагдсан байж болно — шалгана уу.' : 'Хадгаллаа', 'ok');
      ctx.setDirty(false);
      await ctx.reload();
    } else if (r.error === 'validation' && Array.isArray(r.errors)) {
      showErrors(r.errors);
    } else if (r.error === 'version_conflict') {
      const ok = await confirmDialog({ title: 'Өөр хүн өөрчилсөн байна', text: 'Шинэ мэдээллийг ачаалах уу? Таны засвар устна.', ok: 'Ачаалах' });
      if (ok) await ctx.reload();
    }
  });
  const revert = btn('Буцаах', async () => {
    const ok = await confirmDialog({ title: 'Засварыг буцаах уу?', text: 'Хадгалаагүй өөрчлөлт устна.', ok: 'Буцаах' });
    if (ok) ctx.rerender();
  }, 'secondary');

  return h('div', {},
    h('div', { class: 'table-scroll' },
      h('table', { class: 'tbl adm-roster' },
        h('thead', {}, h('tr', {},
          h('th', { scope: 'col' }, '№'),
          FIELDS.map((f) => h('th', { scope: 'col' }, f.label)),
          h('th', { scope: 'col' }, 'Ахлагч'), h('th', { scope: 'col' }, '13+ нас'), h('th', { scope: 'col' }, 'Зөвшөөрөл'), h('th', { scope: 'col' }, h('span', { class: 'visually-hidden' }, 'Арилгах')))),
        tbody)),
    summary,
    h('div', { class: 'row adm-mt' }, save, revert,
      h('span', { class: 'muted small' }, 'Хоосон мөр хадгалагдахгүй. Ахлагч нэг л байна.')));
}

export function render(panel, ctx, ui) {
  const teams = ctx.allTeams();
  if (!teams.length) { panel.appendChild(h('p', { class: 'muted' }, 'Баг олдсонгүй.')); return; }
  if (!ui.teamId || !ctx.team(ui.teamId)) ui.teamId = teams[0].id;
  const t = ctx.team(ui.teamId);

  const picker = h('div', { class: 'adm-picker', role: 'group', 'aria-label': 'Баг сонгох' },
    teams.map((x) => {
      const n = (x.players || []).length;
      const b = h('button', {
        type: 'button', class: `adm-pick ${x.confirmed_at ? 'ok' : ''}`.trim(), 'aria-pressed': String(x.id === t.id),
        title: `${n}/6 тоглогч${x.confirmed_at ? ', батлагдсан' : ''}`,
      }, x.name, h('small', {}, ` ${n}/6`));
      b.addEventListener('click', async () => {
        if (x.id === ui.teamId) return;
        if (ctx.dirty) {
          const ok = await confirmDialog({ title: 'Хадгалаагүй өөрчлөлт байна', text: 'Өөр баг сонговол өөрчлөлт устна.', ok: 'Сонгох', danger: true });
          if (!ok) return;
        }
        ui.teamId = x.id;
        ctx.rerender();
      });
      return b;
    }));

  panel.appendChild(picker);
  const issues = t.checks && Array.isArray(t.checks.errors) ? t.checks.errors : [];
  panel.appendChild(section(`${t.name}${t.is_teachers ? ' (Багш нарын баг)' : ''}`,
    statusChips(t),
    t.confirm_reason ? h('p', { class: 'small muted' }, `Админ баталсан шалтгаан: ${t.confirm_reason}`) : null,
    issues.length && !t.confirmed_at
      ? h('p', { class: 'small adm-warn-text' }, `Батлахад дутуу: ${issues.map((e) => `${e.slot ? `${e.slot}-р тоглогч — ` : ''}${fieldErrorText(e.field, e.code)}`).join('; ')}.`)
      : null,
    actions(ctx, t)));
  panel.appendChild(section('Бүрэлдэхүүн',
    h('p', { class: 'muted small' }, '1–5 үндсэн, 6 — нөөц тоглогч. Админы засвар бүртгэлийн хугацаанаас үл хамаарна, үйлдлийн бүртгэлд хадгалагдана.'),
    editor(ctx, t)));
}
