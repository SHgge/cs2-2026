import { startRouter } from './router.js';
import { store } from './store.js';
import { h, clear } from './ui.js';
import { SCHOOL } from './config.js';

// Зарлалын туузыг бүх хуудсанд харуулна.
function renderBanner(state) {
  const box = document.getElementById('banner');
  if (!box) return;
  clear(box);
  const items = (state && state.announcements) || [];
  for (const a of items) box.appendChild(h('div', { class: `banner banner-${a.level || 'info'}` }, a.text));
  const st = store.status();
  if (st.stale) box.appendChild(h('div', { class: 'banner banner-warn' }, 'Мэдээлэл 5 минутаас дээш шинэчлэгдээгүй байна. Интернэтээ шалгана уу.'));
}

document.getElementById('school').textContent = SCHOOL;
store.subscribe(renderBanner);
startRouter();
store.ready();
