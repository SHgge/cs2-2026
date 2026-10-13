// «Хувийн мэдээлэл»: онлайнаар цуглуулах мэдээлэл, зорилго, боловсруулагч (Supabase Inc.),
// нийтэд юу харагдах, устгах хугацаа, эрх, холбоо барих (content/privacy.html + config.js).
import { h, clear } from '../ui.js';
import { contentInto } from './rules.js';

export default async function render(root) {
  const slot = h('div', { class: 'pv-body' });
  clear(root);
  root.appendChild(h('div', { class: 'pub pv' },
    h('h1', {}, 'Хувийн мэдээллийн хамгаалалт'),
    slot));
  contentInto(slot, 'privacy');
}
