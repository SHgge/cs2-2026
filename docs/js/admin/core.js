// Админы нийтлэг хэсэг: сесс, алдааны текст, баталгаажуулах цонх, татах, жижиг UI туслахууд.
import { errorText } from '../api.js';
import { h, fmtTime } from '../ui.js';
import { validationText } from './util.js';

/* ---------- session (sessionStorage — cleared when the tab closes) ---------- */
const KEY = 'cs2_admin_session';

export function loadSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (s && s.session && (!s.expires_at || Date.parse(s.expires_at) > Date.now())) return s;
    sessionStorage.removeItem(KEY);
  } catch { /* storage blocked */ }
  return null;
}
export function saveSession(s) { try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } }
export function dropSession() { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } }

/* ---------- error text ---------- */
export function errMsg(r) {
  if (!r) return 'Алдаа гарлаа. Дахин оролдоно уу.';
  if (r.error === 'network') return 'Сүлжээний алдаа. Интернэтээ шалгаад дахин оролдоно уу.';
  if (r.error === 'server') return 'Серверийн алдаа гарлаа. Түр хүлээгээд дахин оролдоно уу.';
  let m = errorText(r);
  if ((r.error === 'throttled' || r.error === 'pin_locked') && r.until) m += ` ${fmtTime(r.until)} хүртэл хүлээнэ үү.`;
  if (r.error === 'validation' && Array.isArray(r.errors) && r.errors.length) m += ` ${validationText(r.errors)}.`;
  if (r.error === 'draw_state' && r.reason === 'matches_started') m += ' Хэсгийн тоглолт эхэлсэн байна.';
  if (r.error === 'draw_state' && r.reason === 'no_seats') m += ' Эхлээд сугалааг нийтэлнэ үү.';
  if (r.error === 'pin_locked' && r.hard) m += ' PIN-ийг шинэчилнэ үү.';
  return m;
}

/* ---------- confirm dialog (<dialog>) ---------- */
let dlgSeq = 0;
/**
 * confirmDialog({title, text, ok, cancel, danger, input:{label, placeholder, required, min, match, multiline}})
 * → Promise<false | true | string(input value)>
 */
export function confirmDialog({ title, text = '', ok = 'Тийм', cancel = 'Болих', danger = false, input = null } = {}) {
  return new Promise((resolve) => {
    dlgSeq += 1;
    const id = `adm-dlg-${dlgSeq}`;
    const inp = input
      ? h(input.multiline ? 'textarea' : 'input', {
        type: input.multiline ? null : 'text', rows: input.multiline ? 3 : null, maxlength: input.max || 300,
        placeholder: input.placeholder || '', autocomplete: 'off', 'aria-describedby': `${id}-err`,
      })
      : null;
    if (inp && input.value) inp.value = String(input.value);
    const err = h('p', { class: 'field-error', id: `${id}-err`, role: 'alert' });
    const okBtn = h('button', { type: 'submit', class: danger ? 'btn danger' : 'btn' }, ok);
    const dlg = h('dialog', { class: 'adm-dialog', 'aria-labelledby': `${id}-t` });
    let done = false;
    const close = (v) => {
      if (done) return;
      done = true;
      try { dlg.close(); } catch { /* ignore */ }
      dlg.remove();
      resolve(v);
    };
    const form = h('form', { novalidate: true },
      h('h2', { id: `${id}-t` }, title),
      text ? (Array.isArray(text) ? text.map((t) => h('p', {}, t)) : h('p', {}, text)) : null,
      inp ? h('label', {}, input.label || '', inp) : null,
      err,
      h('div', { class: 'adm-dlg-actions' },
        h('button', { type: 'button', class: 'btn secondary', onclick: () => close(false) }, cancel),
        okBtn));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!inp) { close(true); return; }
      const v = inp.value.trim();
      if (input.match != null && v !== input.match) { err.textContent = `«${input.match}» гэж яг бичнэ үү.`; inp.focus(); return; }
      if (input.required && v.length < (input.min || 1)) {
        err.textContent = input.min > 1 ? `Дор хаяж ${input.min} тэмдэгт бичнэ үү.` : 'Энэ талбарыг бөглөнө үү.';
        inp.focus();
        return;
      }
      close(v);
    });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(false); });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    (inp || okBtn).focus();
  });
}

/* ---------- downloads ---------- */
export function download(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: { display: 'none' } });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------- small UI helpers ---------- */
/** Disables the button while fn runs. */
export async function busy(btn, fn) {
  if (btn && btn.disabled) return undefined;
  if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
  try { return await fn(); } finally { if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); } }
}

export function btn(text, onclick, cls = '', attrs = {}) {
  const b = h('button', { type: 'button', class: `btn ${cls}`.trim(), ...attrs }, text);
  if (onclick) b.addEventListener('click', (e) => busy(b, () => onclick(e, b)));
  return b;
}

export function section(title, ...children) {
  return h('section', { class: 'card adm-sec' }, title ? h('h2', {}, title) : null, ...children);
}

export function kv(label, value, cls = '') {
  return h('div', { class: `adm-kv ${cls}`.trim() }, h('span', { class: 'adm-kv-l' }, label), h('span', { class: 'adm-kv-v' }, value));
}

export function chip(text, kind = '') { return h('span', { class: `chip ${kind}`.trim() }, text); }

export const DRAW_STATUS = {
  none: ['Эхлээгүй', ''], committed: ['Commit илгээсэн', 'warn'], computed: ['Тооцоолсон', 'warn'], published: ['Нийтэлсэн', 'ok'],
};
export const MATCH_STATUS = {
  scheduled: ['Хүлээгдэж буй', ''], live: ['Явагдаж байна', 'warn'], reported: ['Урьдчилсан', 'gold'], final: ['Баталгаажсан', 'ok'],
};
export function matchStatusChip(st) { const [t, k] = MATCH_STATUS[st] || [st || '—', '']; return chip(t, k); }

/** true if a text-like control inside el has focus (the user is typing). */
export function isEditing(el) {
  const a = document.activeElement;
  if (!a || !el || !el.contains(a)) return false;
  if (a.tagName === 'TEXTAREA' || a.tagName === 'SELECT') return true;
  return a.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'file'].includes(a.type);
}
