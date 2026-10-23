// Hash router: #/, #/rules, #/k/<token>, #/ref/<token>, #/admin, #/print/<kind> ...
// «Сургуулийн аварга – CS2 2026». Хуудас бүрийн өмнө document.title-ийг тэмцээний нэр болгоно (хуудас өөрөө сольж болно).
import { BUILD } from './config.js';
import { EVENT_NAME } from './event.js';

const PAGES = {
  '': 'home', rules: 'rules', schedule: 'schedule', groups: 'groups', bracket: 'bracket', faq: 'faq',
  downloads: 'downloads', privacy: 'privacy', draw: 'draw', tv: 'tv', screen: 'screen', k: 'class', ref: 'ref', admin: 'admin', print: 'print',
};
const FULLSCREEN = new Set(['draw', 'tv', 'screen']);
/** Хуудаснууд хувилбаргүй импортолдог дундын модулиуд (кэш эдгэрүүлэхэд хамт дахин татна). */
const SHARED = ['config.js', 'event.js', 'logic.js', 'api.js', 'ui.js', 'store.js', 'phase.js', 'print.js',
  'pages/schedule.js', 'pages/groups.js', 'pages/bracket.js', 'admin/core.js', 'admin/util.js', 'admin/vault.js',
  'admin/qr.js', 'admin/results.js', 'admin/veto.js'];
const HEAL_KEY = 'cs2.router.heal';
const HEAL_MS = 120000;
let cleanup = null;
let navSeq = 0;     // хамгийн сүүлийн шилжилтийн дугаар
let shownSeq = 0;   // зурж дууссан хамгийн сүүлийн шилжилтийн дугаар

export function parseHash() {
  const raw = (location.hash || '#/').replace(/^#\/?/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const key = parts[0] || '';
  const params = { arg: parts[1] || null, query: Object.fromEntries(new URLSearchParams(queryPart)) };
  return { key, page: PAGES[key] || 'home', params };
}

export function go(path) { location.hash = path.startsWith('#') ? path : `#${path}`; }

/**
 * Деплойн дараах кэшийн хавх (GitHub Pages max-age=600): хуудасны модуль шинэ, хувилбаргүй дундын модуль кэшээс хуучин
 * ирвэл импорт тасарна («does not provide an export»), энгийн дахин ачаалалт ч засахгүй. Ийм алдаанд ачаалагдсан js/css-ийг
 * кэшийг алгасан дахин татаж (HTTP кэшийг шинэчилнэ), хуудсыг нэг удаа дахин ачаална. 2 минутын дотор давтахгүй.
 * @returns {Promise<boolean>} true бол хуудас дахин ачаалагдаж байна
 */
export async function healStaleModules(err, pageUrl) {
  const msg = String((err && err.message) || err || '');
  if (!/does not provide an export|dynamically imported module|Importing a module script failed/i.test(msg)) return false;
  try {
    const last = Number(sessionStorage.getItem(HEAL_KEY)) || 0;
    if (Date.now() - last < HEAL_MS) return false;
    sessionStorage.setItem(HEAL_KEY, String(Date.now()));
  } catch { return false; }  // давталтаас хамгаалах тэмдэглэгээгүй бол оролдохгүй
  const base = new URL('./', import.meta.url);
  const site = new URL('../', base).href;
  const urls = new Set(SHARED.map((p) => new URL(p, base).href));
  if (pageUrl) urls.add(new URL(pageUrl, base).href);
  try {
    for (const r of performance.getEntriesByType('resource')) {
      if (r.name.startsWith(site) && /\.(?:js|css)(?:\?|$)/.test(r.name)) urls.add(r.name);
    }
  } catch { /* ignore */ }
  await Promise.all([...urls].map((u) => fetch(u, { cache: 'reload' }).catch(() => null)));
  location.reload();
  return true;
}

async function render() {
  const my = ++navSeq;
  const { key, page, params } = parseHash();
  const root = document.getElementById('app');
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* ignore */ } }
  cleanup = null;
  document.body.dataset.page = page;
  document.title = EVENT_NAME;
  document.body.classList.toggle('fullscreen', FULLSCREEN.has(page) || params.query.overlay === '1');
  for (const a of document.querySelectorAll('[data-nav]')) a.classList.toggle('active', a.dataset.nav === (key || 'home'));
  root.textContent = '';
  root.setAttribute('aria-busy', 'true');
  const pageUrl = page === 'print' ? `./print.js?v=${BUILD}` : `./pages/${page}.js?v=${BUILD}`;
  try {
    const mod = await import(pageUrl);
    if (my !== navSeq) return;                  // хэрэглэгч ачаалал дундаа өөр хуудас руу шилжсэн
    const done = await mod.default(root, params);
    if (my !== navSeq) {
      // Хуучин хуудас шинэ хуудас нээгдсэний дараа дууссан: түүнийг цэвэрлэж, шинэ хуудасны cleanup-ийг дарж бичихгүй.
      if (typeof done === 'function') { try { done(); } catch { /* ignore */ } }
      if (shownSeq === navSeq) render();        // шинэ хуудас аль хэдийн зурагдсан бол хуучин нь #app-ийг дарсан байж болно
      return;
    }
    cleanup = done;
    shownSeq = my;
  } catch (e) {
    if (my !== navSeq) return;
    console.error(e);
    root.textContent = 'Хуудсыг ачаалж чадсангүй. Дахин оролдоно уу.';
    shownSeq = my;
    if (await healStaleModules(e, pageUrl).catch(() => false)) root.textContent = 'Шинэ хувилбарыг ачаалж байна…';
  } finally {
    if (my === navSeq) {
      root.removeAttribute('aria-busy');
      if (!['class', 'ref', 'admin'].includes(page)) window.scrollTo(0, 0);
    }
  }
}

export function startRouter() {
  window.addEventListener('hashchange', render);
  render();
}
