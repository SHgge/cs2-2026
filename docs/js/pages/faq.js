// «Асуулт, хариулт»: 15 асуулт <details> дотор (content/faq.html) + зохион байгуулагчийн холбоо барих.
// SPEC v6: зохион байгуулагч — мэдээллийн технологийн багш (config.js STAFF.organiser).
import { h, clear, phoneLinks } from '../ui.js';
import { STAFF } from '../config.js';
import { contentInto } from './rules.js';

export default async function render(root) {
  const slot = h('div', { class: 'fq-list' });
  clear(root);
  root.appendChild(h('div', { class: 'pub fq' },
    h('h1', {}, 'Асуулт, хариулт'),
    h('p', { class: 'muted' }, 'Асуулт дээр дарж хариултыг нээнэ.'),
    slot,
    h('div', { class: 'card fq-more' },
      h('p', {}, 'Хариулт олдсонгүй юу? Зохион байгуулагчид хандана уу.'),
      h('p', { class: 'fq-contact' }, 'Мэдээллийн технологийн багш ', h('b', {}, STAFF.organiser), ' · утас ', phoneLinks()),
      h('div', { class: 'pub-links' },
        h('a', { class: 'btn secondary', href: '#/rules' }, 'Удирдамж'),
        h('a', { class: 'btn secondary', href: '#/privacy' }, 'Хувийн мэдээлэл')))));
  contentInto(slot, 'faq');
}
