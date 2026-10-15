// «Удирдамж»: 11 товч карт (content/rules.html) + бүтэн баримт (02, 06) татах холбоос.
// contentInto/fillConfig-ийг faq, privacy, home бас ашиглана.
import { h, clear, contentFragment, phoneLinks } from '../ui.js';
import { SCHOOL, FB_PAGE, CONTACT_NAME, CONTACT_PHONE } from '../config.js';
import { EVENT_NAME } from '../event.js';

const CFG = { SCHOOL, FB_PAGE, CONTACT_NAME, CONTACT_PHONE, EVENT_NAME };

/**
 * Статик хэсгийн [data-cfg] нүдийг config.js-ийн утгаар (textContent) бөглөнө.
 * [data-tel] нүдийг утасны дугаар бүрийн тусдаа tel: холбоосоор солино (2 дугаар).
 */
export function fillConfig(el) {
  for (const n of el.querySelectorAll('[data-cfg]')) {
    const v = CFG[n.dataset.cfg];
    if (v) n.textContent = v;
  }
  for (const n of el.querySelectorAll('[data-tel]')) n.replaceWith(phoneLinks());
}

/** content/<name>.html-ийг slot руу ачаална. Хуудас солигдсон бол юу ч хийхгүй. */
export function contentInto(slot, name, after) {
  clear(slot);
  slot.appendChild(h('p', { class: 'muted loading' }, 'Ачаалж байна…'));
  contentFragment(name)
    .then((frag) => {
      if (!slot.isConnected) return;
      fillConfig(frag);
      clear(slot);
      slot.appendChild(frag);
      if (after) after(frag);
    })
    .catch(() => {
      if (!slot.isConnected) return;
      clear(slot);
      slot.appendChild(h('div', { class: 'card error', role: 'alert' },
        'Агуулга ачаалагдсангүй. Интернэтээ шалгаад хуудсыг дахин ачаална уу.'));
    });
}

/** Картуудын товч гарчиг (утсанд хурдан үсрэх). */
function tocFor(frag, box) {
  const cards = [...frag.querySelectorAll('article[id]')];
  if (!cards.length) return;
  box.appendChild(h('nav', { class: 'rl-toc', 'aria-label': 'Агуулга' },
    cards.map((c) => {
      const t = c.querySelector('h2');
      const label = t ? t.textContent.replace(/^\s*\d+\s*/, '').trim() : c.id;
      return h('button', { type: 'button', class: 'rl-toc-b', onclick: () => c.scrollIntoView({ block: 'start' }) }, label);
    })));
}

export default async function render(root) {
  const slot = h('div', { class: 'rl-cards' });
  const toc = h('div', {});
  clear(root);
  root.appendChild(h('div', { class: 'pub rl' },
    h('h1', {}, 'Удирдамж'),
    h('p', { class: 'muted' }, 'Тэмцээний гол дүрэм товчоор. Бүтэн эхийг татаж уншина уу.'),
    h('div', { class: 'pub-links' },
      h('a', { class: 'btn', href: 'assets/docs/02_Udirdamj.docx', download: '' }, 'Бүтэн удирдамж (Word)'),
      h('a', { class: 'btn secondary', href: 'assets/docs/06_Durem.docx', download: '' }, 'Дүрэм, ёс зүй (Word)')),
    toc,
    slot,
    h('p', { class: 'small muted rl-foot' },
      'Энэ хуудас нь товчлол. Зөрүү гарвал батлагдсан удирдамж (02) хүчинтэй.')));
  contentInto(slot, 'rules', (frag) => tocFor(frag, toc));
}
