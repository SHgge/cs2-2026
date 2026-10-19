// 4. Эрх, хэвлэх — ангийн QR (token), багшийн PIN, шүүгчийн QR олгох; хэвлэх, хуулах.
// Нууц кодыг зөвхөн санах ойд (vault) хадгалж, хэвлэх хуудсанд (#/print/...) л харуулна.
import { h, toast, fmtDateTime, copyText } from '../ui.js';
import { btn, section, chip, confirmDialog } from './core.js';
import { vault } from './vault.js';
import { PLACES } from '../config.js';
import {
  shortDateTime, classLinkMessage, pinMessage, linksList, pinsList, refLink, DEFAULT_REG_CLOSES, REF_VALID_FROM, REF_VALID_TO,
} from './util.js';

const goPrint = (kind) => { location.hash = `#/print/${kind}`; };

function teamRef(ctx, item) {
  const t = ctx.team(item.team_id);
  return t || { id: item.team_id, code: item.code, name: item.name, is_teachers: item.code === 'teachers' };
}
const isHidden = (t) => !!t.is_hidden || t.code === 'test';

export function render(panel, ctx) {
  const st = ctx.state;
  const regCloses = (st.settings && st.settings.reg_closes_at) || DEFAULT_REG_CLOSES;
  vault.setMeta({ regClosesAt: regCloses });
  const deadline = shortDateTime(regCloses);
  const teams = ctx.allTeams();

  /* ---- class QR + teacher PIN ---- */
  const issueAll = btn('Бүх ангид эрх олгох', async () => {
    const ok = await confirmDialog({
      title: 'Бүх ангид шинэ эрх олгох уу?',
      text: ['Анги бүрт шинэ QR, багшийн шинэ PIN үүснэ.', 'Өмнө хэвлэсэн, тараасан бүх QR, PIN ажиллахаа болино.'],
      ok: 'Олгох',
      danger: true,
    });
    if (!ok) return;
    const r = await ctx.call('tokens_issue', { kind: 'class_all' });
    if (!r.ok) return;
    const items = Array.isArray(r.items) ? r.items : [];
    vault.putClasses(items.map((it) => [withHidden(teamRef(ctx, it)), { token: it.token || null, pin: it.pin || null }]));
    toast(`${items.length} багт эрх олголоо. Одоо хэвлэнэ үү.`, 'ok', 5000);
    await ctx.reload();
  }, 'gold');

  const rows = teams.map((t) => {
    const mem = vault.classOf(t.id);
    const memText = mem ? [mem.token ? 'QR' : null, mem.pin ? 'PIN' : null].filter(Boolean).join(' + ') : '';
    return h('tr', {},
      h('th', { scope: 'row' }, t.name, isHidden(t) ? h('span', { class: 'muted small' }, ' (тест)') : null),
      h('td', {}, t.has_token ? chip('Олгосон', 'ok') : chip('Олгоогүй', 'warn'),
        t.token_issued_at ? h('div', { class: 'muted small' }, fmtDateTime(t.token_issued_at)) : null,
        t.pin_hard_locked ? h('div', {}, chip('PIN түгжигдсэн', 'err')) : null),
      h('td', {}, memText ? chip(`Санах ойд: ${memText}`, 'gold') : h('span', { class: 'muted small' }, '—')),
      h('td', {}, h('div', { class: 'row' },
        btn('Дахин олгох', async () => {
          const ok = await confirmDialog({
            title: `${t.name} — шинэ QR, PIN олгох уу?`, text: 'Энэ багийн хуучин QR, PIN ажиллахаа болино.', ok: 'Олгох', danger: true,
          });
          if (!ok) return;
          const r = await ctx.call('tokens_issue', { kind: 'class', team_id: t.id });
          if (!r.ok) return;
          vault.putClass(withHidden(t), { token: r.token || null, pin: r.pin || null });
          toast(`${t.name}: шинэ QR, PIN бэлэн. Хэвлэнэ үү.`, 'ok', 5000);
          await ctx.reload();
        }, 'secondary small-btn'),
        btn('PIN шинэчлэх', async () => {
          const ok = await confirmDialog({
            title: `${t.name} — багшийн PIN-ийг шинэчлэх үү?`, text: 'Хуучин PIN ажиллахаа болино. PIN-ий түгжээ мөн тайлагдана.', ok: 'Шинэчлэх', danger: true,
          });
          if (!ok) return;
          const r = await ctx.call('pin_reset', { team_id: t.id });
          if (!r.ok) return;
          vault.putClass(withHidden(t), { pin: r.pin || null });
          toast(`${t.name}: шинэ PIN бэлэн.`, 'ok');
          await ctx.reload();
        }, 'secondary small-btn'),
        mem && mem.token ? btn('Холбоос хуулах', () => copyText(classLinkMessage(mem, deadline)), 'secondary small-btn') : null,
        mem && mem.pin ? btn('PIN хуулах', () => copyText(pinMessage(mem)), 'secondary small-btn') : null)));
  });

  const tokItems = vault.printable('token'); // the hidden test team only when no real class is held (test runs)
  const pinItems = vault.printable('pin');
  const withToken = tokItems.length;
  const withPin = pinItems.length;
  const printBox = withToken || withPin
    ? h('div', { class: 'card ok adm-print' },
      h('h3', {}, 'Хэвлэх, хуулах'),
      h('p', { class: 'small' }, `Санах ойд: QR ${withToken}, PIN ${withPin}. Хуудсыг шинэчилбэл (F5) устна.`),
      h('div', { class: 'row' },
        btn('Ангийн карт хэвлэх', () => goPrint('cards'), '', { disabled: !withToken }),
        btn('Багшийн PIN хэвлэх', () => goPrint('pins'), '', { disabled: !withPin }),
        btn('Бүх холбоос хуулах', () => copyText(linksList(tokItems, deadline)), 'secondary', { disabled: !withToken }),
        btn('Бүх PIN хуулах', () => copyText(pinsList(pinItems)), 'secondary', { disabled: !withPin }),
        btn('Санах ойг цэвэрлэх', async () => {
          const ok = await confirmDialog({ title: 'Санах ойг цэвэрлэх үү?', text: 'Хэвлэж, хуулж дууссан бол цэвэрлэнэ үү. Дахин харах боломжгүй.', ok: 'Цэвэрлэх', danger: true });
          if (ok) { vault.clearClasses(); toast('Цэвэрлэлээ', 'ok'); }
        }, 'secondary')),
      h('p', { class: 'muted small' }, 'Холбоосыг ангийн чатад, PIN-ийг анги удирдсан багшид тус тусад нь илгээнэ үү.'))
    : null;

  panel.appendChild(section('Ангийн QR ба багшийн PIN',
    h('p', {}, `QR-ийг ангийн чатад, PIN-ийг анги удирдсан багшид өгнө. Бүртгэлийн хугацаа: ${deadline}.`),
    h('div', { class: 'row' }, issueAll, h('span', { class: 'small adm-warn-text' }, 'Өмнө хэвлэсэн бүх QR, PIN хүчингүй болно.')),
    printBox,
    h('div', { class: 'table-scroll adm-mt' },
      h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Баг'), h('th', { scope: 'col' }, 'QR'), h('th', { scope: 'col' }, 'Энэ цонхонд'), h('th', { scope: 'col' }, 'Үйлдэл'))),
        h('tbody', {}, rows)))));

  /* ---- referees ---- */
  const refs = st.referees || [];
  const refMem = vault.referees();
  const issueRef = (station, label) => btn(label, async () => {
    const name = await confirmDialog({
      title: `${label} — шинэ эрх олгох уу?`,
      text: `QR ${shortDateTime(REF_VALID_FROM)} – ${shortDateTime(REF_VALID_TO)} хүртэл хүчинтэй.`,
      ok: 'Олгох',
      input: { label: 'Нэр (хэвлэхэд харагдана)', required: true, min: 2, max: 60, value: label },
    });
    if (!name) return;
    const r = await ctx.call('tokens_issue', { kind: 'referee', station, label: name });
    if (!r.ok || !r.token) return;
    vault.addReferee({ label: r.label || name, station, token: r.token });
    toast(`${name}: QR бэлэн. Хэвлэнэ үү.`, 'ok');
    await ctx.reload();
  }, 'secondary');

  panel.appendChild(section('Шүүгчийн эрх',
    h('p', { class: 'muted small' }, `Станцын шүүгч зөвхөн өөрийн станцын, ерөнхий шүүгч бүх тоглолтын оноог оруулна. QR ${shortDateTime(REF_VALID_FROM)} – ${shortDateTime(REF_VALID_TO)} хүртэл хүчинтэй.`),
    h('div', { class: 'row' }, issueRef('A', 'А станцын шүүгч'), issueRef('B', 'Б станцын шүүгч'), issueRef(null, 'Ерөнхий шүүгч')),
    refMem.length
      ? h('div', { class: 'card ok adm-print' },
        h('h3', {}, `Санах ойд: ${refMem.length} шүүгчийн QR`),
        h('div', { class: 'row' },
          btn('Шүүгчийн хуудас хэвлэх', () => goPrint('ref')),
          refMem.map((r) => btn(`${r.label} — холбоос хуулах`, () => copyText(`${r.label}: ${refLink(r.token)}`), 'secondary small-btn')),
          btn('Цэвэрлэх', async () => {
            const ok = await confirmDialog({ title: 'Шүүгчийн кодыг санах ойгоос устгах уу?', ok: 'Устгах', danger: true });
            if (ok) vault.clearReferees();
          }, 'secondary small-btn')))
      : null,
    refs.length
      ? h('div', { class: 'table-scroll adm-mt' }, h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Шүүгч'), h('th', { scope: 'col' }, 'Станц'), h('th', { scope: 'col' }, 'Төлөв'), h('th', { scope: 'col' }, 'Үйлдэл'))),
        h('tbody', {}, refs.map((r) => h('tr', {},
          h('td', {}, r.label || '—'),
          h('td', {}, r.station === 'A' ? 'А станц' : r.station === 'B' ? 'Б станц' : 'Бүх тоглолт'),
          h('td', {}, r.active === false ? chip('Идэвхгүй') : chip('Идэвхтэй', 'ok'), r.created_at ? h('span', { class: 'muted small' }, ` ${fmtDateTime(r.created_at)}`) : null),
          h('td', {}, r.active === false || r.id == null ? null : btn('Хүчингүй болгох', async () => {
            const ok = await confirmDialog({ title: `${r.label || 'Шүүгч'} — холбоосыг хүчингүй болгох уу?`, text: 'Энэ QR-ээр дахин нэвтрэх боломжгүй болно.', ok: 'Хүчингүй болгох', danger: true });
            if (ok) await ctx.act('referee_revoke', { id: r.id }, 'Хүчингүй болголоо');
          }, 'secondary small-btn')))))))
      : h('p', { class: 'muted small' }, 'Шүүгчид эрх олгоогүй байна.')));

  /* ---- site poster ---- */
  panel.appendChild(section('Сайтын QR зурагт хуудас',
    h('p', { class: 'muted small' }, `Самбар, анги, ${PLACES.hall}д наах A4 хуудас. Нууц код агуулахгүй.`),
    btn('Зурагт хуудас нээх', () => goPrint('site'), 'secondary')));

  return vault.subscribe(() => ctx.rerender());
}

function withHidden(t) { return { ...t, is_hidden: isHidden(t) }; }
