// «Татах»: удирдамж (02), зөвшөөрлийн маягт (05, 05б), дүрэм (06), хуваарийн схем (12).
import { h, clear } from '../ui.js';

const FILES = [
  { no: '02', title: 'Тэмцээний удирдамж', note: 'Бүтэн дүрэм, систем, шагнал, хуваарь.', href: 'assets/docs/02_Udirdamj.docx', kind: 'DOCX' },
  { no: '05', title: 'Эцэг эхийн зөвшөөрөл', note: '05б хамт (3-р хуудас). Хэвлэж бөглөөд 10.21 (Лх) 17:00 хүртэл анги удирдсан багшид өгнө үү.', href: 'assets/docs/05_Zovshoorol.docx', kind: 'DOCX', key: true },
  { no: '05б', title: 'Нэмэлт зөвшөөрөл (цахим бүртгэл)', note: 'Бүх оролцогч бөглөнө. 05-ыг өмнө нь авсан бол зөвхөн үүнийг хэвлэнэ үү.', href: 'assets/docs/05b_Nemelt_zovshoorol.docx', kind: 'DOCX' },
  { no: '06', title: 'Тоглолтын дүрэм ба ёс зүй', note: 'Тоглогч, менежер бүр уншиж танилцана.', href: 'assets/docs/06_Durem.docx', kind: 'DOCX' },
  { no: '12', title: 'Хуваарийн схем, A3', note: 'Хоёр өдөр нэг дор. Самбарт хэвлэнэ.', href: 'assets/docs/12_Huvaari.pdf', kind: 'PDF', open: true },
  { no: '12', title: 'Хуваарийн схем (зураг)', note: 'Хоёр өдөр нэг дор.', href: 'assets/img/12_Huvaari.png', kind: 'PNG', open: true },
  { no: '12а', title: '1-р өдрийн хуваарь', note: 'Утсаар харах, ангийн чатад тавих.', href: 'assets/img/12a_Huvaari_1r_odor.png', kind: 'PNG', open: true },
  { no: '12б', title: '2-р өдрийн хуваарь', note: 'Утсаар харах, ангийн чатад тавих.', href: 'assets/img/12b_Huvaari_2r_odor.png', kind: 'PNG', open: true },
];

export default async function render(root) {
  clear(root);
  root.appendChild(h('div', { class: 'pub dl' },
    h('h1', {}, 'Татах'),
    h('p', { class: 'muted' }, 'Маягт, удирдамж, хуваарь. Word файлыг хэвлэж ашиглана.'),
    h('ul', { class: 'dl-list' }, FILES.map((f) => h('li', {},
      h('a', {
        class: `dl-item${f.key ? ' key' : ''}`, href: f.href,
        ...(f.open ? { target: '_blank', rel: 'noopener' } : { download: '' }),
      },
      h('span', { class: `dl-kind k-${f.kind.toLowerCase()}` }, f.kind),
      h('span', { class: 'dl-text' },
        h('b', {}, `${f.no} · ${f.title}`),
        h('span', { class: 'small muted' }, f.note)),
      h('span', { class: 'dl-go', 'aria-hidden': 'true' }, f.open ? 'Нээх' : 'Татах'))))),
    h('p', { class: 'small muted' }, 'Зөвшөөрлийн маягтыг цаасаар өгнө. Сайтад зөвхөн «өгсөн» гэсэн тэмдэглэгээ хийнэ.')));
}
