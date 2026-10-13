// UI туслахууд. Өгөгдлийг ЗӨВХӨН textContent-ээр гаргана (XSS-ээс хамгаална).
import { TZ } from './config.js';

/** h('div', {class:'x', onclick:fn, dataset:{a:1}}, 'text', child, [children]) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') throw new Error('html attr is not allowed; use content fragments');
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

const WEEKDAY = ['Ням', 'Даваа', 'Мягмар', 'Лхагва', 'Пүрэв', 'Баасан', 'Бямба'];

function parts(iso) {
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d);
  const o = Object.fromEntries(f.map((p) => [p.type, p.value]));
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[o.weekday];
  return { y: o.year, m: o.month, d: o.day, hh: o.hour === '24' ? '00' : o.hour, mm: o.minute, wd };
}

/** 09:45 */
export function fmtTime(iso) { if (!iso) return ''; const p = parts(iso); return `${p.hh}:${p.mm}`; }
/** 10.24 (Бямба) */
export function fmtDate(iso) { if (!iso) return ''; const p = parts(iso); return `${p.m}.${p.d} (${WEEKDAY[p.wd]})`; }
/** 10.24 (Бямба) 09:45 */
export function fmtDateTime(iso) { return iso ? `${fmtDate(iso)} ${fmtTime(iso)}` : ''; }
/** 2 хоног 04:12:09 */
export function fmtCountdown(ms) {
  if (ms <= 0) return '0';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return d > 0 ? `${d} хоног ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

let toastBox = null;
export function toast(msg, kind = 'info', ms = 3500) {
  if (!toastBox) { toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(toastBox); }
  const t = h('div', { class: `toast toast-${kind}` }, msg);
  toastBox.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export function teamName(state, id) {
  if (id == null) return '—';
  const t = state && state.teams ? state.teams.find((x) => x.id === id) : null;
  return t ? t.name : '—';
}

export const GROUP_LABEL = { A: 'А', B: 'Б', V: 'В', G: 'Г' };
export function groupChip(grp) { return h('span', { class: `chip grp-${grp}` }, `${GROUP_LABEL[grp] || grp} хэсэг`); }
export function stationLabel(st) { return st === 'A' ? 'А станц' : st === 'B' ? 'Б станц' : ''; }

export function loading(root, text = 'Ачаалж байна…') { clear(root); root.appendChild(h('p', { class: 'muted loading' }, text)); }
export function errorBox(root, msg) { root.appendChild(h('div', { class: 'card error', role: 'alert' }, msg)); }

export async function copyText(str) {
  try { await navigator.clipboard.writeText(str); toast('Хуулагдлаа', 'ok'); return true; } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }); ta.value = str; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Хуулагдлаа', 'ok'); return true; } catch { return false; } finally { ta.remove(); }
  }
}

/** Static Mongolian content fragment from docs/content/<name>.html (no user data inside). */
export async function contentFragment(name) {
  const res = await fetch(`content/${name}.html`, { cache: 'no-cache' });
  const div = h('div', { class: 'content' });
  div.innerHTML = res.ok ? await res.text() : '<p>Агуулга ачаалагдсангүй.</p>';
  return div;
}
