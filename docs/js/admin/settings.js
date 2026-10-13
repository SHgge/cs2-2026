// 7. Зарлал, тохиргоо — зарлал нийтлэх/нуух, бүртгэл нээх/хаах, дамжуулалтын холбоос,
// үйлдлийн бүртгэл, бүх сесс хаах, мэдээлэл устгах («УСТГАХ»).
import { h, toast, fmtDateTime, teamName } from '../ui.js';
import { btn, section, chip, confirmDialog } from './core.js';
import { isoToLocalInput, localInputToIso } from './util.js';

const PURGE = [
  ['stream', 'Дамжуулалтын мэдээлэл устгах', 'Шууд дамжуулалтад зориулсан мэдээллийг устгана. Facebook-ээс бичлэгийг устгасны дараа (11.01) хийнэ үү.'],
  ['personal', 'Хувийн мэдээллийг бүрэн устгах', 'Тоглогчдын нэр, Steam мэдээлэл, зөвшөөрлийн тэмдэглэгээг бүрмөсөн устгана. 12.31-ээс өмнө хийнэ үү.'],
];

const ACTION_LABEL = {
  login: 'Нэвтэрсэн', logout: 'Гарсан', admin_setup: 'Анхны тохиргоо', admin_setup_fail: 'Тохиргооны код буруу',
  admin_login_fail: 'Нэвтрэх оролдлого буруу', team_save: 'Бүрэлдэхүүн зассан', team_unconfirm: 'Баталгаа цуцалсан',
  confirm_on_behalf: 'Багшийн өмнөөс баталсан', consent_set: 'Зөвшөөрөл, хоч нэр', lock: 'Түгжээ',
  unlock_until: 'Засвар түр нээсэн', settings_set: 'Тохиргоо', announce: 'Зарлал нийтэлсэн', announce_hide: 'Зарлал нуусан',
  tokens_issue: 'Эрх олгосон', pin_reset: 'PIN шинэчилсэн', referee_revoke: 'Шүүгчийн эрх цуцалсан', export: 'Файл татсан',
  draw_commit: 'Сугалаа: commit', draw_compute: 'Сугалаа: тооцоолсон', draw_publish: 'Сугалаа: нийтэлсэн',
  draw_void: 'Сугалаа: хүчингүй', draw_manual: 'Гар сугалаа', draw_bad_commit: 'Сугалаа: нууц тоо таараагүй',
  match_live: 'Тоглолт эхэлсэн', match_reported: 'Оноо (урьдчилсан)', match_final: 'Оноо (баталгаажсан)',
  match_update: 'Хуваарь өөрчилсөн', group_lot: 'Хэсгийн сугалаа', group_approve: 'Хэсгийн дүн', purge: 'Мэдээлэл устгасан',
  sessions_revoke: 'Сесс хаасан', class_save: 'Анги хадгалсан', class_confirm: 'Багш баталсан',
};
/** 'admin:Нэр' → 'Нэр', 'ref:Нэр' → 'Шүүгч: Нэр', 'class:8a' → 'Анги: 8a' */
function actorText(a) {
  const s = String(a || '');
  if (!s || s === 'anon') return '—';
  const [role, ...rest] = s.split(':');
  const name = rest.join(':');
  if (role === 'admin') return name || 'Админ';
  if (role === 'ref') return name ? `Шүүгч: ${name}` : 'Шүүгч';
  if (role === 'class') return name ? `Анги: ${name}` : 'Анги';
  return s;
}

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
    h('p', { class: 'muted small' }, 'Нүүр хуудас, ТВ дэлгэцэнд «Шууд үзэх» товч болж харагдана.'),
    deadlinesBox(ctx, S));
}

const DEADLINES = [
  ['reg_closes_at', 'Бүртгэл хаагдах'],
  ['consent_deadline_at', 'Зөвшөөрлийн хугацаа'],
  ['roster_freeze_at', 'Бүрэлдэхүүн царцах (сугалаа)'],
];
/** Rarely needed: move a deadline for everyone (one class → «Бүртгэл» → «хүртэл нээх»). */
function deadlinesBox(ctx, S) {
  const inputs = DEADLINES.map(([key, label]) => {
    const inp = h('input', { type: 'datetime-local', step: 300, id: `adm-dl-${key}` });
    inp.value = isoToLocalInput(S[key]);
    inp.addEventListener('change', () => ctx.setDirty(true));
    return { key, label, inp };
  });
  return h('details', { class: 'adm-mt' },
    h('summary', {}, 'Хугацаа өөрчлөх (шийдвэр гарсан үед л)'),
    h('p', { class: 'muted small' }, 'Бүх ангид үйлчилнэ. Нэг ангид бол «Бүртгэл» хэсгийн «хүртэл нээх»-ийг ашиглана уу.'),
    h('div', { class: 'adm-dl-grid' }, inputs.map(({ key, label, inp }) => h('label', { for: `adm-dl-${key}` }, label, inp))),
    h('div', { class: 'row adm-mt' }, btn('Хугацаа хадгалах', async () => {
      const args = {};
      for (const { key, inp } of inputs) {
        const iso = localInputToIso(inp.value);
        if (!iso) { toast('Огноо, цагаа бүрэн оруулна уу.', 'err'); inp.focus(); return; }
        if (Date.parse(iso) !== Date.parse(S[key] || '')) args[key] = iso;
      }
      const keys = Object.keys(args);
      if (!keys.length) { toast('Өөрчлөлт алга.', 'warn'); return; }
      const ok = await confirmDialog({
        title: 'Хугацааг өөрчлөх үү?',
        text: keys.map((k) => `${DEADLINES.find((d) => d[0] === k)[1]}: ${fmtDateTime(args[k])}`),
        ok: 'Хадгалах',
      });
      if (ok) await ctx.act('settings_set', args, 'Хугацаа шинэчиллээ');
    }, 'secondary')));
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
          h('td', {}, actorText(a.actor || a.actor_label || a.by)),
          h('td', { title: a.action || '' }, ACTION_LABEL[a.action] || a.action || '—'),
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
        const r = await ctx.act('purge', { phase, confirm: 'УСТГАХ' }, null);
        if (r.ok) {
          typed.value = '';
          toast(phase === 'personal'
            ? `Устгалаа: ${r.players ?? 0} тоглогч, ${r.referees ?? 0} шүүгчийн холбоос, ${r.sessions ?? 0} сесс.`
            : `Устгалаа: ${r.ticks ?? 0} тоглогчийн 3а–3в тэмдэглэгээ, хоч нэр.`, 'ok', 6000);
        }
      }, 'danger'))));
}

export function render(panel, ctx) {
  panel.append(announcements(ctx), settingsBox(ctx), auditBox(ctx), securityBox(ctx));
}
