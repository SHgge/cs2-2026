// «Асуулт, хариулт»: 14 асуулт <details> дотор (content/faq.html) + зохион байгуулагчийн холбоо барих.
import { h, clear, phoneLinks } from '../ui.js';
import { CONTACT_NAME } from '../config.js';
import { contentInto } from './rules.js';

export default async function render(root) {
  const slot = h('div', { class: 'fq-list' });
  clear(root);
  root.appendChild(h('div', { class: 'pub fq' },
    h('h1', {}, 'Асуулт, хариулт'),
    h('p', { class: 'muted' }, 'Асуулт дээр дарж хариултыг нээнэ.'),
    slot,
    h('div', { class: 'card fq-more' },
      h('p', {}, 'Хариулт олдсонгүй юу? Зохион байгуулагч багшид хандана уу.'),
      h('p', { class: 'fq-contact' }, h('b', {}, CONTACT_NAME), ' · утас ', phoneLinks()),
      h('div', { class: 'pub-links' },
        h('a', { class: 'btn secondary', href: '#/rules' }, 'Удирдамж'),
        h('a', { class: 'btn secondary', href: '#/privacy' }, 'Хувийн мэдээлэл')))));
  contentInto(slot, 'faq');
}
