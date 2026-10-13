// #/admin — зохион байгуулагчийн удирдлага: нэвтрэх/анхны тохиргоо, 7 хэсэгтэй самбар.
import * as api from '../api.js';
import { h, clear, toast, fmtTime, loading, errorBox } from '../ui.js';
import { loadSession, saveSession, dropSession, errMsg, confirmDialog, isEditing, btn, busy } from '../admin/core.js';
import { vault } from '../admin/vault.js';
import * as dashboard from '../admin/dashboard.js';
import * as roster from '../admin/roster.js';
import * as consent from '../admin/consent.js';
import * as access from '../admin/access.js';
import * as draw from '../admin/draw.js';
import * as results from '../admin/results.js';
import * as settings from '../admin/settings.js';

const TABS = [
  { key: 'dash', label: 'Самбар', mod: dashboard, live: true },
  { key: 'roster', label: 'Бүртгэл', mod: roster },
  { key: 'consent', label: 'Зөвшөөрөл', mod: consent },
  { key: 'access', label: 'Эрх, хэвлэх', mod: access },
  { key: 'draw', label: 'Сугалаа', mod: draw },
  { key: 'results', label: 'Үр дүн', mod: results, live: true },
  { key: 'settings', label: 'Зарлал, тохиргоо', mod: settings },
];
const POLL_MS = 30000;
const tabUi = {}; // хэсэг бүрийн UI төлөв (сонгосон баг, шүүлтүүр) — хуудас солигдоход хадгалагдана

const isReal = (t) => !t.is_hidden && t.code !== 'test';
/** fetch failed → 'network'; HTTP error (e.g. API not deployed yet) → 'server' (generic message). */
const transportError = (e) => ({ ok: false, error: e && e.message === 'network' ? 'network' : 'server', detail: e && e.message });

function normalize(r) {
  const teams = (r.teams || []).slice().sort((a, b) => a.id - b.id)
    .map((t) => ({ ...t, players: (t.players || []).slice().sort((a, b) => a.slot - b.slot) }));
  return {
    ...r,
    teams,
    matches: (r.matches || []).slice().sort((a, b) => a.no - b.no),
    announcements: r.announcements || [],
    referees: r.referees || [],
    audit: r.audit || [],
    decisions: r.decisions || {},
    draw: r.draw || { status: 'none' },
    settings: r.settings || {},
  };
}

export default async function render(root, params) {
  let alive = true;
  let timer = null;
  let tabCleanup = null;
  let ctx = null;
  let panel = null;
  let tablist = null;
  let staleBar = null;
  let vaultBar = null;
  const offs = [];
  const wanted = params && params.query && params.query.tab;
  let currentTab = TABS.some((t) => t.key === wanted) ? wanted : 'dash';

  function stopTab() {
    if (typeof tabCleanup === 'function') { try { tabCleanup(); } catch (e) { console.error(e); } }
    tabCleanup = null;
  }
  function stopAll() {
    clearInterval(timer);
    timer = null;
    stopTab();
    while (offs.length) offs.pop()();
  }

  /* ---------------- login & one-time setup ---------------- */
  async function doLogin(label, secret, errEl) {
    let r;
    try { r = await api.adminLogin(label, secret); } catch (e) { r = transportError(e); }
    if (!r || !r.ok || !r.session) { errEl.textContent = errMsg(r); return false; }
    saveSession({ session: r.session, expires_at: r.expires_at || null, label: r.label || label });
    return true;
  }

  function showLogin(note) {
    stopAll();
    clear(root);
    const errL = h('p', { class: 'field-error', role: 'alert' });
    const label = h('input', { id: 'adm-l', name: 'username', autocomplete: 'username', maxlength: 60, spellcheck: 'false' });
    const secret = h('input', { id: 'adm-s', type: 'password', name: 'password', autocomplete: 'current-password', maxlength: 200 });
    const loginBtn = h('button', { type: 'submit', class: 'btn block' }, 'Нэвтрэх');
    const loginForm = h('form', { class: 'card', novalidate: true },
      h('h2', {}, 'Нэвтрэх'),
      h('label', { for: 'adm-l' }, 'Нэвтрэх нэр'), label,
      h('label', { for: 'adm-s' }, 'Нууц үг'), secret,
      errL,
      h('div', { class: 'adm-mt' }, loginBtn));
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      errL.textContent = '';
      const l = label.value.trim();
      if (!l || !secret.value) { errL.textContent = 'Нэр, нууц үгээ оруулна уу.'; return; }
      busy(loginBtn, async () => {
        if (await doLogin(l, secret.value, errL)) { secret.value = ''; await showConsole(); }
      });
    });

    const errS = h('p', { class: 'field-error', role: 'alert' });
    const code = h('input', { id: 'adm-c', autocomplete: 'off', spellcheck: 'false', maxlength: 200 });
    const sLabel = h('input', { id: 'adm-sl', autocomplete: 'off', maxlength: 60, placeholder: 'Жишээ: Зохион байгуулагч' });
    const s1 = h('input', { id: 'adm-s1', type: 'password', autocomplete: 'new-password', maxlength: 200 });
    const s2 = h('input', { id: 'adm-s2', type: 'password', autocomplete: 'new-password', maxlength: 200 });
    const setupBtn = h('button', { type: 'submit', class: 'btn block' }, 'Тохируулаад нэвтрэх');
    const setupForm = h('form', { novalidate: true },
      h('p', { class: 'muted' }, 'Систем ашиглаж эхлэхэд нэг удаа хийнэ. Тохиргооны кодыг хариуцсан хүнээс авна уу.'),
      h('label', { for: 'adm-c' }, 'Тохиргооны код'), code,
      h('label', { for: 'adm-sl' }, 'Нэвтрэх нэр'), sLabel,
      h('label', { for: 'adm-s1' }, 'Нууц үг (10-аас доошгүй тэмдэгт)'), s1,
      h('label', { for: 'adm-s2' }, 'Нууц үгээ давтана уу'), s2,
      errS,
      h('div', { class: 'adm-mt' }, setupBtn));
    setupForm.addEventListener('submit', (e) => {
      e.preventDefault();
      errS.textContent = '';
      const c = code.value.trim();
      const l = sLabel.value.trim();
      if (!c || !l || !s1.value) { errS.textContent = 'Бүх талбарыг бөглөнө үү.'; return; }
      if (s1.value.length < 10) { errS.textContent = 'Нууц үг 10-аас доошгүй тэмдэгттэй байна.'; s1.focus(); return; }
      if (s1.value !== s2.value) { errS.textContent = 'Нууц үг таарахгүй байна.'; s2.focus(); return; }
      busy(setupBtn, async () => {
        let r;
        try { r = await api.adminSetup(c, l, s1.value); } catch (e) { r = transportError(e); }
        if (!r || !r.ok) { errS.textContent = errMsg(r); return; }
        toast('Админ үүслээ.', 'ok');
        if (await doLogin(l, s1.value, errS)) { s1.value = ''; s2.value = ''; code.value = ''; await showConsole(); }
      });
    });

    root.appendChild(h('div', { class: 'adm-auth' },
      h('h1', {}, 'Зохион байгуулагч'),
      note ? h('div', { class: 'card warn', role: 'status' }, note) : null,
      loginForm,
      h('details', { class: 'adm-setup' }, h('summary', {}, 'Анхны тохиргоо (зөвхөн нэг удаа)'), setupForm),
      h('p', { class: 'muted small' }, 'Нэвтрэлт 12 цаг хүчинтэй. Цонхоо хаавал гарна. Хамтын компьютер дээр «Гарах» дарна уу.')));
    label.focus();
  }

  function sessionExpired() {
    dropSession();
    showLogin('Нэвтрэх хугацаа дууссан. Дахин нэвтэрнэ үү.');
  }

  /* ---------------- console ---------------- */
  function makeCtx(ses) {
    const c = {
      session: ses.session,
      label: ses.label,
      expiresAt: ses.expires_at,
      state: null,
      dirty: false,
      pending: null,
      /** RPC cs2_admin(session, action, args). Never throws; shows a toast on error unless quiet. */
      async call(action, args = {}, { quiet = false } = {}) {
        let r;
        try { r = await api.admin(c.session, action, args); } catch (e) { r = transportError(e); }
        if (!r || typeof r !== 'object') r = { ok: false, error: 'unknown' };
        if (!r.ok && r.error === 'bad_session') { if (alive) sessionExpired(); return r; }
        if (!r.ok && !quiet && alive) toast(errMsg(r), 'err', 6000);
        return r;
      },
      /** Re-fetch the overview; re-render the current tab unless render:false. */
      async reload({ render = true } = {}) {
        const r = await c.call('overview', {}, { quiet: true });
        if (!alive) return false;
        if (!r.ok) { if (r.error !== 'bad_session') toast(errMsg(r), 'err'); return false; }
        c.state = normalize(r);
        c.pending = null;
        if (staleBar) staleBar.hidden = true;
        if (render && panel) renderTab(true);
        return true;
      },
      /** Mutating call: toast on success, then reload + re-render. */
      async act(action, args, okText, { reload = true } = {}) {
        const r = await c.call(action, args);
        if (r.ok) {
          if (okText) toast(okText, 'ok');
          if (reload) { c.dirty = false; await c.reload(); }
        }
        return r;
      },
      /** Background refresh after small edits (no re-render). */
      softReload() {
        clearTimeout(c.softTimer);
        c.softTimer = setTimeout(() => { if (alive) c.reload({ render: false }); }, 1500);
      },
      rerender() { renderTab(true); },
      setDirty(v) { c.dirty = !!v; },
      go(tab, patch) { if (patch) Object.assign(tabUi[tab] || (tabUi[tab] = {}), patch); selectTab(tab); },
      teams() { return c.state.teams.filter(isReal); },
      allTeams() { return c.state.teams.slice(); },
      team(id) { return c.state.teams.find((t) => t.id === id) || null; },
      teamByCode(code) { return c.state.teams.find((t) => t.code === code) || null; },
      logoutLocal() { dropSession(); vault.clear(); showLogin('Системээс гарлаа.'); },
    };
    return c;
  }

  async function showConsole() {
    const ses = loadSession();
    if (!ses) { showLogin(); return; }
    stopAll();
    ctx = makeCtx(ses);
    loading(root, 'Мэдээлэл ачаалж байна…');
    const ok = await ctx.reload({ render: false });
    if (!alive || !loadSession()) return; // bad_session → login already shown
    if (!ok) {
      clear(root);
      errorBox(root, 'Мэдээлэл ачаалж чадсангүй. Интернэтээ шалгана уу.');
      root.appendChild(h('div', { class: 'row' }, btn('Дахин оролдох', () => showConsole()), btn('Гарах', () => logout(), 'secondary')));
      return;
    }
    buildShell();
    timer = setInterval(poll, POLL_MS);
  }

  function buildShell() {
    clear(root);
    const who = `${ctx.label || 'Админ'}${ctx.expiresAt ? ` · ${fmtTime(ctx.expiresAt)} хүртэл` : ''}`;
    const head = h('div', { class: 'adm-head' },
      h('h1', {}, 'Удирдлага'),
      h('span', { class: 'muted small' }, who),
      h('span', { class: 'spacer' }),
      btn('Шинэчлэх', () => refreshNow(), 'secondary'),
      btn('Гарах', () => logout(), 'secondary'));
    vaultBar = h('div', { class: 'adm-vaultbar', role: 'status', hidden: true });
    staleBar = h('div', { class: 'adm-stale', role: 'status', hidden: true },
      h('span', {}, 'Шинэ өөрчлөлт ирлээ.'), btn('Шинэчлэх', () => refreshNow(), 'secondary'));
    tablist = h('div', { class: 'adm-tabs', role: 'tablist', 'aria-label': 'Удирдлагын хэсгүүд' },
      TABS.map((t) => h('button', {
        type: 'button', role: 'tab', id: `adm-tab-${t.key}`, class: 'adm-tab', 'aria-controls': 'adm-panel', dataset: { key: t.key },
        onclick: () => trySelect(t.key),
      }, t.label)));
    tablist.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const i = TABS.findIndex((t) => t.key === currentTab);
      const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
      e.preventDefault();
      trySelect(next.key).then(() => { const b = document.getElementById(`adm-tab-${currentTab}`); if (b) b.focus(); });
    });
    panel = h('div', { id: 'adm-panel', class: 'adm-panel', role: 'tabpanel', tabindex: '-1' });
    root.appendChild(h('div', { class: 'adm' }, head, vaultBar, tablist, staleBar, panel));
    offs.push(vault.subscribe(updateVaultBar));
    updateVaultBar();
    renderTab(false);
  }

  function updateVaultBar() {
    if (!vaultBar) return;
    const c = vault.counts();
    const codes = c.class + c.referee;
    vaultBar.hidden = codes === 0 && c.drawUnsaved === 0;
    clear(vaultBar);
    if (codes) {
      vaultBar.appendChild(h('span', {}, `Санах ойд ${codes} нууц код байна (QR, PIN). Хуудсыг шинэчилбэл устна — эхлээд хэвлэнэ үү.`));
      if (currentTab !== 'access') vaultBar.appendChild(btn('Эрх, хэвлэх', () => trySelect('access'), 'secondary'));
    }
    if (c.drawUnsaved) {
      vaultBar.appendChild(h('span', {}, 'Сугалааны нууц тоог хадгалаагүй байна — татах эсвэл хэвлэнэ үү.'));
      if (currentTab !== 'draw') vaultBar.appendChild(btn('Сугалаа', () => trySelect('draw'), 'secondary'));
    }
  }

  async function trySelect(key) {
    if (key === currentTab) return;
    if (ctx.dirty) {
      const ok = await confirmDialog({ title: 'Хадгалаагүй өөрчлөлт байна', text: 'Өөр хэсэг рүү шилжвэл өөрчлөлт устна.', ok: 'Шилжих', danger: true });
      if (!ok) return;
    }
    selectTab(key);
  }

  function selectTab(key) {
    currentTab = TABS.some((t) => t.key === key) ? key : 'dash';
    try { history.replaceState(null, '', `#/admin?tab=${currentTab}`); } catch { /* ignore */ }
    if (ctx.pending) { ctx.state = normalize(ctx.pending); ctx.pending = null; staleBar.hidden = true; }
    renderTab(false);
    updateVaultBar();
  }

  function renderTab(keepScroll) {
    if (!panel) return;
    stopTab();
    const def = TABS.find((t) => t.key === currentTab) || TABS[0];
    for (const b of tablist.children) {
      const on = b.dataset.key === def.key;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    panel.setAttribute('aria-labelledby', `adm-tab-${def.key}`);
    const y = window.scrollY;
    clear(panel);
    ctx.dirty = false;
    try {
      tabCleanup = def.mod.render(panel, ctx, tabUi[def.key] || (tabUi[def.key] = {}));
    } catch (e) {
      console.error(e);
      errorBox(panel, 'Энэ хэсгийг харуулж чадсангүй. «Шинэчлэх» дарна уу.');
    }
    if (keepScroll) window.scrollTo(0, y);
  }

  async function refreshNow() {
    if (ctx.dirty) {
      const ok = await confirmDialog({ title: 'Хадгалаагүй өөрчлөлт байна', text: 'Шинэчилбэл өөрчлөлт устна.', ok: 'Шинэчлэх', danger: true });
      if (!ok) return;
    }
    if (await ctx.reload()) toast('Шинэчиллээ', 'ok', 1500);
  }

  async function poll() {
    if (!alive || !ctx || !ctx.state || document.hidden) return;
    let r;
    try { r = await api.admin(ctx.session, 'overview', {}); } catch { return; }
    if (!alive || !r) return;
    if (!r.ok) { if (r.error === 'bad_session') sessionExpired(); return; }
    if (r.version === ctx.state.version) return;
    const def = TABS.find((t) => t.key === currentTab);
    if (def && def.live && !ctx.dirty && !isEditing(panel) && !document.querySelector('dialog[open]')) {
      ctx.state = normalize(r);
      renderTab(true);
    } else {
      ctx.pending = r;
      staleBar.hidden = false;
    }
  }

  async function logout() {
    if (vault.unsaved() > 0) {
      const ok = await confirmDialog({ title: 'Гарах уу?', text: 'Санах ойд хэвлээгүй код байж магадгүй. Гарвал тэдгээр устна.', ok: 'Гарах', danger: true });
      if (!ok) return;
    }
    const s = ctx && ctx.session;
    if (s) { try { await api.adminLogout(s); } catch { /* ignore */ } }
    dropSession();
    vault.clear();
    toast('Гарлаа', 'ok');
    showLogin();
  }

  if (loadSession()) await showConsole(); else showLogin();

  return () => { alive = false; stopAll(); };
}
