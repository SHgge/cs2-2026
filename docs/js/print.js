// #/print/<kind> — хэвлэх хуудсууд (A4).
//   site   — сайтын QR зурагт хуудас (нууц кодгүй, хэн ч нээж болно)
//   cards  — ангийн QR карт (нэг хуудсанд 6), pins — багшийн PIN хуудас (12),
//   ref    — шүүгчийн QR хуудас (4), secret — сугалааны нууц тоо.
// Нууц кодыг зөвхөн санах ойгоос (admin/vault.js) уншина: хуудсыг шинэчилбэл устна.
import { h, clear, errorBox, mnt } from './ui.js';
import { SITE_URL, SCHOOL, FB_PAGE, CONTACT_PHONE, STAFF, PLACES } from './config.js';
import { EVENT_NAME, CUP_NAME, FEE, PRIZES } from './event.js';
import { vault } from './admin/vault.js';
import { loadQr, qrNode } from './admin/qr.js';
import {
  classLink, refLink, shortDateTime, secretGroups, siteLabel, chunk, DEFAULT_REG_CLOSES, REF_VALID_FROM, REF_VALID_TO,
} from './admin/util.js';

const TITLE = EVENT_NAME;
/** School logo (SPEC v5 §0.5): white cube on navy; 192 px for the small cells, 512 px for the A4 poster. */
const LOGO = 'assets/img/logo-192.png';
const LOGO_BIG = 'assets/img/logo-512.png';
const BACK_ACCESS = ['#/admin?tab=access', 'Админ руу буцах'];
/** SPEC v6: хүсэлт, асуулт — зохион байгуулагч (мэдээллийн технологийн багш); нэрийг config.js-ийн STAFF-аас авна. */
const CONTACT = `Асуулт: зохион байгуулагч ${STAFF.organiser}, утас ${CONTACT_PHONE}`;
const NO_CODES = 'Хэвлэх код энэ цонхны санах ойд алга (хуудсыг шинэчилсэн эсвэл эрх олгоогүй). Админ → «Эрх, хэвлэх» хэсэгт эрх олгоод энэ хуудсыг дахин нээнэ үү.';

const STEPS_STUDENT = [
  'QR-ийг утасныхаа камераар уншуулаарай.',
  '6 тоглогчийн мэдээллийг бөглөөрэй (5 үндсэн + 1 нөөц).',
  'Анги удирдсан багшаараа PIN кодоор батлуулаарай.',
];
const STEPS_ADULT = [
  'QR-ийг утасныхаа камераар уншуулна уу.',
  '6 тоглогчийн мэдээллийг бөглөнө үү (5 үндсэн + 1 нөөц).',
  'Багийн ахлагч PIN кодоор баталгаажуулна уу.',
];
const STEPS_REF = [
  'QR-ийг утсаараа уншуулна уу.',
  'Ахлагчид ээлжлэн тус бүр 3 газрын зураг хасна.',   // нэг мөрөнд багтана: 135 мм нүдэнд анхааруулга таслагдахгүй
  'Тоглолт эхлэхэд төлөвийг тэмдэглэнэ үү.',
  'Тоглолт дуусмагц оноог оруулна уу.',
];

const sheet = (cls, ...children) => h('section', { class: `pr-sheet ${cls}` }, ...children);
/** Top row of every printed cell: logo + school + event name (+ a short tag on the right). */
const brand = (tag) => h('div', { class: 'pr-brand' },
  h('img', { class: 'pr-logo', src: LOGO, alt: '', width: 192, height: 192 }),
  h('div', { class: 'pr-brand-text' }, h('b', {}, SCHOOL), h('span', {}, TITLE)),
  tag ? h('span', { class: 'pr-brand-tag' }, tag) : null);
const deadlineText = () => shortDateTime(vault.meta().regClosesAt || DEFAULT_REG_CLOSES);

function classCard(qr, it, deadline) {
  const adult = it.is_teachers;
  return h('article', { class: 'pr-cell pr-card' },
    brand('Багийн бүртгэл'),
    h('div', { class: `pr-card-name ${[...it.name].length > 6 ? 'long' : ''}`.trim() }, it.name),
    h('div', { class: 'pr-card-body' },
      qrNode(qr, classLink(it.token), 'pr-qr-card'),
      h('ol', { class: 'pr-steps' }, (adult ? STEPS_ADULT : STEPS_STUDENT).map((s) => h('li', {}, s)))),
    h('div', { class: 'pr-card-deadline' }, `Хугацаа: ${deadline}`),
    h('div', { class: 'pr-contact' }, CONTACT),
    h('div', { class: 'pr-warn' }, adult ? 'Холбоосыг зөвхөн багийн гишүүдэд хуваалцана уу.' : 'Холбоосыг зөвхөн ангийн чатад хуваалцаарай.'));
}

function pinSlip(it, deadline) {
  const t = it.is_teachers; // «Багш нарын баг»: the PIN goes to the team captain
  // grid: team name + warning on the left, PIN on the right (one row even for «Багш нарын баг»)
  return h('article', { class: 'pr-cell pr-pin' },
    brand(t ? 'Зөвхөн багийн ахлагчид' : 'Зөвхөн багшид'),
    h('b', { class: `pr-pin-team ${[...it.name].length > 6 ? 'long' : ''}`.trim() }, it.name),
    h('div', { class: 'pr-pin-codebox' },
      h('span', { class: 'pr-pin-label' }, t ? 'Ахлагчийн PIN:' : 'Багшийн PIN:'), h('b', { class: 'pr-pin-code' }, it.pin)),
    h('div', { class: 'pr-pin-warn' }, t ? 'Бусдад бүү өгнө үү.' : 'Сурагчдад бүү өгнө үү.'),
    h('p', { class: 'pr-pin-note' }, `${t ? 'Багийн мэдээллийг бөглөсний дараа ахлагч' : 'Сурагчид мэдээллээ бөглөсний дараа'} энэ PIN-ээр батална уу. Хугацаа: ${deadline}. 5 удаа буруу оруулбал 15 минут түгжигдэнэ. ${CONTACT}.`));
}

function refSlip(qr, r) {
  return h('article', { class: 'pr-cell pr-ref' },
    brand('Шүүгчийн эрх'),
    h('div', { class: 'pr-ref-label' }, r.label),
    h('div', { class: 'pr-ref-station' }, r.station === 'A' ? 'А станцын тоглолтууд' : r.station === 'B' ? 'Б станцын тоглолтууд' : 'Бүх тоглолт (ерөнхий шүүгч)'),
    qrNode(qr, refLink(r.token), 'pr-qr-ref'),
    h('div', { class: 'pr-ref-valid' }, `Хүчинтэй: ${shortDateTime(REF_VALID_FROM)} – ${shortDateTime(REF_VALID_TO)}`),
    h('ol', { class: 'pr-steps' }, STEPS_REF.map((s) => h('li', {}, s))),
    h('div', { class: 'pr-warn' }, 'Бусдад бүү дамжуулна уу. Утсаа түгжээтэй байлгана уу.'));
}

function buildCards(qr) {
  const items = vault.printable('token');
  if (!items.length) return { empty: NO_CODES };
  const deadline = deadlineText();
  return {
    sheets: chunk(items, 6).map((g) => sheet('pr-cards', h('div', { class: 'pr-grid pr-grid-cards' }, g.map((it) => classCard(qr, it, deadline))))),
    note: `${items.length} карт, нэг хуудсанд 6. Тасархай зураасаар хайчилна уу.`,
  };
}

function buildPins() {
  const items = vault.printable('pin');
  if (!items.length) return { empty: NO_CODES };
  const deadline = deadlineText();
  return {
    sheets: chunk(items, 12).map((g) => sheet('pr-pins', h('div', { class: 'pr-grid pr-grid-pins' }, g.map((it) => pinSlip(it, deadline))))),
    note: `${items.length} PIN. Анги удирдсан багш бүрт гарт нь өгнө үү.`,
  };
}

function buildRef(qr) {
  const items = vault.referees();
  if (!items.length) return { empty: NO_CODES };
  return {
    sheets: chunk(items, 4).map((g) => sheet('pr-refs', h('div', { class: 'pr-grid pr-grid-refs' }, g.map((r) => refSlip(qr, r))))),
    note: `${items.length} шүүгчийн хуудас.`,
  };
}

function buildSite(qr) {
  const [t1, t2 = ''] = EVENT_NAME.split(' – ');   // «Сургуулийн аварга» / «CS2 2026»
  return {
    sheets: [sheet('pr-site',
      h('div', { class: 'pr-site-brand' },
        h('img', { class: 'pr-site-logo', src: LOGO_BIG, alt: '', width: 512, height: 512 }),
        h('div', { class: 'pr-site-school' }, SCHOOL)),
      h('h1', { class: 'pr-site-title' }, t1, h('br'), h('span', {}, t2)),
      h('p', { class: 'pr-site-sub' }, '8–12-р ангийн Counter-Strike 2 тэмцээн'),
      h('p', { class: 'pr-site-dates' }, '10.24 (Бя) хэсгийн шат · 10.25 (Ня) хасагдах шат'),
      qrNode(qr, SITE_URL, 'pr-qr-site'),
      h('p', { class: 'pr-site-cta' }, 'Утасныхаа камераар уншуулаарай'),
      h('p', { class: 'pr-site-url' }, siteLabel()),
      h('ul', { class: 'pr-site-list' }, ['Хуваарь, хэсгийн байр, оноо', 'Шууд дамжуулалтын холбоос', 'Удирдамж, асуулт хариулт'].map((t) => h('li', {}, t))),
      h('p', { class: 'pr-site-prize' }, `Шагналын сан ${mnt(PRIZES.fund)} (MVP ${mnt(PRIZES.mvp_cash)} орсон) · «${CUP_NAME}» шилжин явах цом`),
      h('p', { class: 'pr-site-contact' }, CONTACT),
      h('p', { class: 'pr-site-foot' }, `Шууд дамжуулалт: Facebook «${FB_PAGE}» · Хураамж ${mnt(FEE.team)}\u00A0/\u00A0баг · Skin, item, бооцоо байхгүй · Valve-ийн албан ёсны тэмцээн биш`))],
  };
}

function buildSecret() {
  const d = vault.draw();
  if (!d) return { empty: 'Нууц тоо энэ цонхны санах ойд алга. Админ → «Сугалаа» хэсэгт үүсгээд энэ хуудсыг дахин нээнэ үү.' };
  return {
    sheets: [sheet('pr-secret',
      brand('Нууц — битүүмжилнэ'),
      h('h1', {}, 'Сугалааны нууц тоо'),
      h('p', {}, `Сугалаа: 10.22 (Пү) 16:00, техникийн зөвлөгөөн (${PLACES.lab})`),
      h('div', { class: 'pr-secret-box' }, secretGroups(d.secret, 8)),
      h('p', { class: 'pr-secret-commit' }, h('b', {}, 'Commit (нийтэд ил): '), h('span', {}, d.commit)),
      h('p', {}, `Үүсгэсэн: ${shortDateTime(d.at)}`),
      h('ol', { class: 'pr-steps' },
        ['Энэ хуудсыг дугтуйнд хийж битүүмжилнэ үү.', 'Сугалаа хүртэл хэнд ч бүү үзүүлнэ үү.', 'Сугалааны үед нууц тоог админ хуудсанд оруулна уу.', 'Нууц тоо commit-тэй таарч байгааг хүн бүр шалгаж болно.']
          .map((s) => h('li', {}, s))))],
  };
}

const KINDS = {
  site: { title: 'Сайтын QR зурагт хуудас', back: ['#/', 'Нүүр хуудас'], build: buildSite, qr: true },
  cards: { title: 'Ангийн QR карт', back: BACK_ACCESS, build: buildCards, qr: true },
  pins: { title: 'Багшийн PIN хуудас', back: BACK_ACCESS, build: buildPins },
  ref: { title: 'Шүүгчийн QR хуудас', back: BACK_ACCESS, build: buildRef, qr: true },
  secret: { title: 'Сугалааны нууц тоо', back: ['#/admin?tab=draw', 'Админ руу буцах'], build: buildSecret },
};

/** Waits (max 3 s) until the logos are loaded, so they are never missing on paper. */
function imagesReady() {
  const imgs = Array.from(document.querySelectorAll('.pr-doc img')).filter((i) => !i.complete);
  if (!imgs.length) return Promise.resolve();
  const each = imgs.map((i) => new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); }));
  return Promise.race([Promise.all(each), new Promise((r) => { setTimeout(r, 3000); })]);
}

function toolbar(key, def, built) {
  const printBtn = h('button', { type: 'button', class: 'btn', disabled: !!built.empty }, 'Хэвлэх');
  printBtn.addEventListener('click', async () => {
    if (key === 'secret') vault.markDrawSaved();
    await imagesReady();
    window.print();
  });
  return h('div', { class: 'pr-toolbar no-print' },
    h('div', { class: 'row' },
      h('a', { class: 'btn secondary', href: def.back[0] }, `← ${def.back[1]}`),
      h('h1', {}, def.title),
      h('span', { class: 'spacer' }),
      printBtn),
    h('p', { class: 'muted small' }, 'Цаас A4, босоо. Масштаб 100% («Fit to page» биш). «Headers and footers»-ийг унтраана уу.'),
    built.note ? h('p', { class: 'small' }, built.note) : null);
}

export default async function render(root, params) {
  const key = params && params.arg;
  const def = KINDS[key];
  clear(root);
  if (!def) {
    root.appendChild(h('div', { class: 'card' },
      h('h1', {}, 'Хэвлэх хуудас'),
      h('p', {}, 'Ийм хуудас олдсонгүй.'),
      h('p', {}, h('a', { href: '#/print/site' }, 'Сайтын QR зурагт хуудас'))));
    return undefined;
  }
  const prevTitle = document.title;
  document.title = `${def.title} · ${TITLE}`;
  const restore = () => { document.title = prevTitle; };
  let qr = null;
  if (def.qr) {
    try { qr = await loadQr(); } catch {
      errorBox(root, 'QR үүсгэх файл ачаалагдсангүй. Хуудсыг дахин ачаална уу.');
      return restore;
    }
  }
  const built = def.build(qr);
  root.appendChild(toolbar(key, def, built));
  if (built.empty) root.appendChild(h('div', { class: 'card warn' }, built.empty));
  else root.appendChild(h('div', { class: 'pr-doc', dataset: { kind: key } }, built.sheets));
  return restore;
}
