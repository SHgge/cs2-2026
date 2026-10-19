// Hash router: #/, #/rules, #/k/<token>, #/ref/<token>, #/admin, #/print/<kind> ...
// «Сургуулийн аварга – CS2 2026». Хуудас бүрийн өмнө document.title-ийг тэмцээний нэр болгоно (хуудас өөрөө сольж болно).
import { BUILD } from './config.js';
import { EVENT_NAME } from './event.js';

const PAGES = {
  '': 'home', rules: 'rules', schedule: 'schedule', groups: 'groups', bracket: 'bracket', faq: 'faq',
  downloads: 'downloads', privacy: 'privacy', draw: 'draw', tv: 'tv', screen: 'screen', k: 'class', ref: 'ref', admin: 'admin', print: 'print',
};
const FULLSCREEN = new Set(['draw', 'tv', 'screen']);
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
  try {
    const mod = page === 'print'
      ? await import(`./print.js?v=${BUILD}`)
      : await import(`./pages/${page}.js?v=${BUILD}`);
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
