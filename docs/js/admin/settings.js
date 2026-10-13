// 7. Зарлал, тохиргоо — зарлал нийтлэх/нуух, бүртгэл нээх/хаах, дамжуулалтын холбоос,
// үйлдлийн бүртгэл, бүх сесс хаах, мэдээлэл устгах («УСТГАХ»).
import { h, toast, fmtDateTime, teamName } from '../ui.js';
import { btn, section, chip, confirmDialog } from './core.js';

const PURGE = [
  ['stream', 'Дамжуулалтын мэдээлэл устгах', 'Шууд дамжуулалтад зориулсан мэдээллийг устгана. Facebook-ээс бичлэгийг устгасны дараа (11.01) хийнэ үү.'],
  ['personal', 'Хувийн мэдээллийг бүрэн устгах', 'Тоглогчдын нэр, Steam мэдээлэл, зөвшөөрлийн тэмдэглэгээг бүрмөсөн устгана. 12.31-ээс өмнө хийнэ үү.'],
];

function detailText(v) {
  if (v == null) return '';
  if (typeof v !== 'object') return String(v);
  const s = Object.entries(v).map(([k, x]) => `${k}: ${x && typeof x === 'object' ? JSON.stringify(x) : x}`).join(', ');
  return s.length > 200 ? `${s.slice(0, 199)}…` : s;
}

function announcements(ctx) {
  const st = ctx.state;
  const text = h('textarea', { rows: 2, maxlength: 200, id: 'adm-ann', placeholder: 'Жишээ: 10.24-нд 08:30-д бүртгэл эхэлнэ.' });
  const level = h('select', { 'aria-label': 'Төрөл' }, h('option', { value: 'info' }, 'Мэдээлэл'), h('option', { value: 'warn' }, 'Анхааруулга'));
  const left = h('span', { class: 'muted small' }, '0/200');
  text.addEventListener('input', () => { left.textContent = `${text.value.length}/200`; ctx.setDirty(text.value.trim() !== ''); });
  const list = st.announcements || [];
  return section('Зарлал',
    h('p', { class: 'muted small' }, 'Бүх хуудасны дээд хэсэгт тууз болж харагдана. Нэр, утас бүү бичнэ үү.'),
    h('label', { for: 'adm-ann' }, 'Шинэ зарлал'), text,
    h('div', { class: 'row adm-mt' }, level, left, h('span', { class: 'spacer' }),
      btn('Нийтлэх', async () => {
        const v = text.value.trim();
        if (!v) { toast('Зарлалын текстээ бичнэ үү.', 'err'); text.focus(); return; }
        await ctx.act('announce', { text: v, level: level.value }, 'Зарлал нийтэллээ');
      })),
    list.length
      ? h('ul', { class: 'adm-anns' }, list.map((a) => {
        const hidden = !!a.hidden_at || a.hidden === true || a.active === false;
        return h('li', { class: hidden ? 'is-hidden' : '' },
          chip(a.level === 'warn' ? 'Анхааруулга' : 'Мэдээлэл', a.level === 'warn' ? 'warn' : ''),
          h('span', { class: 'adm-ann-text' }, a.text || ''),
          h('span', { class: 'muted small' }, fmtDateTime(a.at || a.created_at)),
          hidden ? chip('Нуусан') : btn('Нуух', async () => {
            const ok = await confirmDialog({ title: 'Зарлалыг нуух уу?', text: a.text || '', ok: 'Нуух' });
            if (ok) await ctx.act('announce_hide', { id: a.id }, 'Нууллаа');
          }, 'secondary small-btn'));
      }))
      : h('p', { class: 'muted small' }, 'Идэвхтэй зарлал алга.'));
}

function settingsBox(ctx) {
  const S = ctx.state.settings || {};
  const open = S.registration_open !== false;
  const url = h('input', { type: 'url', id: 'adm-stream', inputmode: 'url', maxlength: 300, placeholder: 'https://www.facebook.com/…/live' });
  url.value = S.stream_url || '';
  url.addEventListener('input', () => ctx.setDirty(url.value.trim() !== (S.stream_url || '')));
  return section('Тохиргоо',
    h('div', { class: 'row' },
      h('span', {}, 'Бүртгэл: '), chip(open ? 'Нээлттэй' : 'Хаалттай', open ? 'ok' : 'err'),
      btn(open ? 'Бүртгэлийг хаах' : 'Бүртгэлийг нээх', async () => {
        const ok = await confirmDialog(open
          ? { title: 'Бүртгэлийг одоо хаах уу?', text: 'Ангиуд мэдээллээ засах боломжгүй болно. Админ засах боломжтой хэвээр.', ok: 'Хаах', danger: true }
          : { title: 'Бүртгэлийг нээх үү?', text: 'Хугацаа дуусаагүй бол ангиуд дахин засах боломжтой болно.', ok: 'Нээх' });
        if (ok) await ctx.act('settings_set', { registration_open: !open }, open ? 'Бүртгэлийг хаалаа' : 'Бүртгэлийг нээлээ');
      }, open ? 'secondary' : '')),
    h('label', { for: 'adm-stream' }, 'Шууд дамжуулалтын холбоос (Facebook)'),
    h('div', { class: 'row' }, url,
      btn('Хадгалах', async () => {
        const v = url.value.trim();
        if (v && !/^https:\/\/\S+$/.test(v)) { toast('Холбоос https://-ээр эхэлнэ.', 'err'); url.focus(); return; }
        await ctx.act('settings_set', { stream_url: v || null }, v ? 'Холбоос хадгаллаа' : 'Холбоосыг арилгалаа');
      }, 'secondary')),
    h('p', { class: 'muted small' }, 'Нүүр хуудас, ТВ дэлгэцэнд «Шууд үзэх» товч болж харагдана.'));
}

function auditBox(ctx) {
  const rows = (ctx.state.audit || []).slice(0, 50);
  return h('details', { class: 'card adm-sec' },
    h('summary', {}, `Үйлдлийн бүртгэл (сүүлийн ${rows.length})`),
    rows.length
      ? h('div', { class: 'table-scroll' }, h('table', { class: 'tbl adm-audit' },
        h('thead', {}, h('tr', {}, ['Хэзээ', 'Хэн', 'Үйлдэл', 'Дэлгэрэнгүй'].map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', {}, rows.map((a) => h('tr', {},
          h('td', { class: 'nowrap' }, fmtDateTime(a.at || a.created_at)),
          h('td', {}, a.actor || a.actor_label || a.by || '—'),
          h('td', {}, a.action || '—'),
          h('td', { class: 'small' }, [
            a.team_id != null ? `${teamName(ctx.state, Number(a.team_id))}. ` : '',
            a.match_no != null ? `№${a.match_no}. ` : '',
            detailText(a.detail || a.details)].join('')))))))
      : h('p', { class: 'muted small' }, 'Бүртгэл хоосон.'));
}

function securityBox(ctx) {
  const typed = h('input', { type: 'text', id: 'adm-purge', autocomplete: 'off', spellcheck: 'false', placeholder: 'УСТГАХ', maxlength: 10 });
  return section('Аюулгүй байдал, устгах',
    h('div', { class: 'row' },
      btn('Бүх сессийг хаах', async () => {
        const ok = await confirmDialog({
          title: 'Бүх админ сессийг хаах уу?', text: 'Та болон бусад админ бүгд системээс гарна. Дахин нэвтрэх шаардлагатай.', ok: 'Хаах', danger: true,
        });
        if (!ok) return;
        const r = await ctx.call('sessions_revoke', {});
        if (r.ok) { toast('Бүх сессийг хаалаа.', 'ok'); ctx.logoutLocal(); }
      }, 'secondary'),
      h('span', { class: 'muted small' }, 'Нууц үг алдагдсан гэж сэжиглэвэл ашиглана уу.')),
    h('hr'),
    h('label', { for: 'adm-purge' }, 'Устгахын өмнө «УСТГАХ» гэж бичнэ үү'),
    typed,
    PURGE.map(([phase, label, desc]) => h('div', { class: 'adm-purge' },
      h('p', { class: 'small' }, desc),
      btn(label, async () => {
        if (typed.value.trim() !== 'УСТГАХ') { toast('Дээрх талбарт «УСТГАХ» гэж бичнэ үү.', 'err'); typed.focus(); return; }
        const ok = await confirmDialog({ title: `${label}?`, text: [desc, 'Энэ үйлдлийг буцаах боломжгүй.'], ok: 'Устгах', danger: true });
        if (!ok) return;
        const r = await ctx.act('purge', { phase, confirm: 'УСТГАХ' }, 'Устгалаа');
        if (r.ok) typed.value = '';
      }, 'danger'))));
}

export function render(panel, ctx) {
  panel.append(announcements(ctx), settingsBox(ctx), auditBox(ctx), securityBox(ctx));
}
