// «Сургуулийн аварга – CS2 2026» — нийтийн бүрхүүл: зарлалын тууз, толгойн сургуулийн нэр, хөлийн холбоо барих.
import { startRouter } from './router.js';
import { store } from './store.js';
import { h, clear, phoneLinks } from './ui.js';
import { SCHOOL, CONTACT_NAME } from './config.js';

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

function fillShell() {
  const school = document.getElementById('school');
  if (school) school.textContent = SCHOOL;
  const fSchool = document.getElementById('footer-school');
  if (fSchool) fSchool.textContent = SCHOOL;
  const contact = document.getElementById('footer-contact');
  if (contact) {
    clear(contact);
    contact.append('Зохион байгуулагч: ', CONTACT_NAME, ' · ', phoneLinks());
  }
}

fillShell();
store.subscribe(renderBanner);
startRouter();
store.ready();
