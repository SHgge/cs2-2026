// Нүүр: нэр, огноо, дараагийн алхам хүртэлх тоолуур, хураамж ба шагналын сан, «Яаж оролцох» (5),
// бүртгэлийн явц (12 баг — зөвхөн тоо), гол огноо, систем (6), «Шууд үзэх» (settings.stream_url байвал).
// logic.js-ээс шууд хамаарахгүй (тэмцээний өдрүүдэд л schedule.js-ийг динамикаар ачаална).
// SPEC v5: бүртгэл = бүрэлдэхүүн царцах 10.23 (Ба) 23:59 (settings.roster_freeze_at); сугалаа 10.22 (Пү) 16:00
// (event.js DRAW_AT) бүрэлдэхүүнийг царцаахгүй.
import { h, clear, fmtTime, fmtDate, fmtCountdown, contentFragment, mnt } from '../ui.js';
import { store } from '../store.js';
import { SCHOOL } from '../config.js';
import { EVENT_NAME, DATES, DRAW_AT, FEE, PRIZES } from '../event.js';
import { fillConfig } from './rules.js';

const DEF = {
  reg: DATES.reg_closes_at,
  freeze: DATES.roster_freeze_at,
  consent: DATES.consent_deadline_at,
  fee: DATES.fee_due_at,
  draw: DRAW_AT,
  drill: DATES.drill_to,
  day1: '2026-10-24T09:00:00+08:00',
  day1End: '2026-10-24T18:00:00+08:00',
  day2Start: '2026-10-25T08:30:00+08:00',
  day2: '2026-10-25T09:30:00+08:00',
  day2End: '2026-10-25T18:00:00+08:00',
};
const WD_SHORT = { 'Ням': 'Ня', 'Даваа': 'Да', 'Мягмар': 'Мя', 'Лхагва': 'Лх', 'Пүрэв': 'Пү', 'Баасан': 'Ба', 'Бямба': 'Бя' };
const t = (iso) => { const v = Date.parse(iso); return Number.isFinite(v) ? v : NaN; };
const dShort = (iso) => fmtDate(iso).replace(/\(([^)]+)\)/, (_, w) => `(${WD_SHORT[w] || w})`);
const dt = (iso) => `${dShort(iso)} ${fmtTime(iso)}`;
const validIso = (v, def) => (v && Number.isFinite(Date.parse(v)) ? v : def);

/** Сугалааны цаг тогтмол (DRAW_AT); roster_freeze_at-ийг зөвхөн бүртгэл, бүрэлдэхүүн царцахад ашиглана. */
function settingsOf(state) {
  const s = (state && state.settings) || {};
  return {
    reg: validIso(s.reg_closes_at, DEF.reg),
    freeze: validIso(s.roster_freeze_at, DEF.freeze),
    consent: validIso(s.consent_deadline_at, DEF.consent),
    fee: DEF.fee,
    draw: DEF.draw,
    open: s.registration_open,
    stream: s.stream_url,
  };
}

const same = (a, b) => t(a) === t(b);

/** Тоолуурын дараагийн алхмууд, цагийн дарааллаар. */
function milestones(s) {
  const sameDue = same(s.consent, s.fee);
  return [
    { at: s.draw, label: 'Хэсгийн сугалаа хүртэл' },
    { at: s.consent, label: sameDue ? 'Зөвшөөрөл, хураамж өгөх хугацаа дуусах хүртэл' : 'Эцэг эхийн зөвшөөрөл өгөх хугацаа дуусах хүртэл' },
    sameDue ? null : { at: s.fee, label: 'Багийн хураамж төлөх хугацаа дуусах хүртэл' },
    { at: s.reg, label: same(s.reg, s.freeze) ? 'Бүртгэл хаагдаж, бүрэлдэхүүн царцах хүртэл' : 'Бүртгэл хаагдах хүртэл' },
    same(s.reg, s.freeze) ? null : { at: s.freeze, label: 'Бүрэлдэхүүн царцах хүртэл' },
    { at: DEF.day1, label: 'Тэмцээн эхлэх хүртэл' },
    { at: DEF.day2, label: '2-р өдөр эхлэх хүртэл' },
  ].filter(Boolean).sort((a, b) => t(a.at) - t(b.at));
}

/** Финал (19), 3-р байр (20) хоёулаа баталгаажсан уу (logic-гүйгээр төлөвөөс шууд). */
function finished(state) {
  const ms = state && Array.isArray(state.matches) ? state.matches.filter((m) => m && (m.no === 19 || m.no === 20)) : [];
  return ms.length === 2 && ms.every((m) => m.status === 'final');
}

function phase(now, state) {
  if (now >= t(DEF.day2End) || (now >= t(DEF.day2Start) && finished(state))) return 'over';
  if (now >= t(DEF.day1) && now < t(DEF.day1End)) return 'day1';
  if (now >= t(DEF.day2Start) && now < t(DEF.day2End)) return 'day2';
  return 'pre';
}

function streamBtn(s) {
  const url = String(s.stream || '');
  if (!/^https:\/\/[^\s"'<>]+$/i.test(url)) return null;
  return h('a', { class: 'btn gold hm-live', href: url, target: '_blank', rel: 'noopener noreferrer' },
    h('span', { class: 'hm-dot', 'aria-hidden': 'true' }), 'Шууд үзэх');
}

function keyDates(s, now) {
  const sameDue = same(s.consent, s.fee);
  const sameFreeze = same(s.reg, s.freeze);
  const items = [
    { end: DEF.drill, when: '10.19–23', text: 'Steam-ээр QR нэвтрэх дадлага' },
    { end: s.draw, when: dt(s.draw), text: 'Техникийн зөвлөгөөн, хэсгийн сугалаа. Анги бүрээс ахлагч эсвэл төлөөлөгч ирнэ' },
    { end: s.consent, when: dt(s.consent), text: sameDue
      ? `Эцэг эхийн зөвшөөрөл (05, 05б), цаасан маягт 04, багийн хураамж ${mnt(FEE.team)}`
      : 'Эцэг эхийн зөвшөөрөл (05, 05б), цаасан маягт 04' },
    sameDue ? null : { end: s.fee, when: dt(s.fee), text: `Багийн хураамж ${mnt(FEE.team)}` },
    { end: s.reg, when: dt(s.reg), text: sameFreeze ? 'Онлайн бүртгэл хаагдана, бүрэлдэхүүн царцана' : 'Онлайн бүртгэл хаагдана (ангийн QR)' },
    sameFreeze ? null : { end: s.freeze, when: dt(s.freeze), text: 'Бүрэлдэхүүн царцана' },
    { end: DEF.day1End, when: '10.24 (Бя) 09:45–16:45', text: '1-р өдөр: хэсгийн шат. Бүртгэл 08:30, нээлт 09:00' },
    { end: DEF.day2End, when: '10.25 (Ня) 09:30', text: '2-р өдөр: шөвгийн 8 · 13:00 шөвгийн 4 · 14:45 финал, 3-р байр · 16:15 шагнал' },
  ];
  return h('section', { class: 'hm-sec' },
    h('h2', {}, 'Гол огноо'),
    h('ul', { class: 'hm-dates' }, items.filter(Boolean).map((it) => {
      const past = now >= t(it.end);
      return h('li', { class: past ? 'past' : '' },
        h('b', {}, it.when), h('span', {}, it.text), past ? h('span', { class: 'hm-done', 'aria-label': 'болсон' }, '✓') : null);
    })));
}

/** Хураамж ба шагналын сан (SPEC v5 §2a, §5) — тоо event.js-ээс. */
function prizeCard(s) {
  const titles = ['Аварга', '2-р байр', '3-р байр'];
  return h('section', { class: 'card hm-prize', 'aria-labelledby': 'hm-prize-h' },
    h('h2', { id: 'hm-prize-h' }, 'Хураамж ба шагнал'),
    h('div', { class: 'hm-fee' },
      h('span', { class: 'hm-fee-l' }, 'Багийн хураамж'),
      h('b', { class: 'hm-fee-v' }, mnt(FEE.team), h('small', {}, ' / анги')),
      h('span', { class: 'hm-fee-d' }, `${dt(s.fee)} хүртэл сургуулийн нягтлан бодогчид төлж, баримт авна`)),
    h('p', { class: 'hm-fund' }, 'Шагналын сан ', h('b', {}, mnt(PRIZES.fund))),
    h('ol', { class: 'hm-places' }, PRIZES.place.map((v, i) => h('li', { class: `hm-place p${i + 1}` },
      h('span', { class: 'hm-place-n' }, titles[i]),
      h('b', { class: 'hm-place-v' }, mnt(v)),
      h('span', { class: 'hm-place-pp' }, `тоглогч бүрд ${mnt(PRIZES.per_player[i])}`)))),
    h('p', { class: 'hm-mvp' }, h('b', {}, 'MVP'), ` — тэмцээний шилдэг тоглогч: жижиг цом + ${mnt(PRIZES.mvp_cash)}`),
    h('p', { class: 'small muted hm-prize-note' },
      'Багш нарын баг хураамж төлөхгүй, мөнгөн шагнал авахгүй. Бүх хураамж шагналд зарцуулагдана. ',
      h('a', { href: '#/rules' }, 'Дэлгэрэнгүй →')));
}

function regChip(team) {
  const r = team.reg || null;
  const n = r ? Number(r.players) || 0 : null;
  const ok = !!(r && r.confirmed);
  const cls = !r ? 'none' : ok ? 'ok' : n >= 5 ? 'ready' : n > 0 ? 'part' : 'none';
  return h('div', { class: `hm-chip ${cls}` },
    h('b', { class: 'hm-chip-n' }, team.name),
    h('span', {}, r ? `${n}/6 тоглогч` : '—'),
    h('span', { class: 'hm-chip-ok' }, ok ? '✓ Баталгаажсан' : 'Баталгаажаагүй'),
    h('span', {}, r ? `Зөвшөөрөл ${Number(r.consents) || 0}` : ''));
}

function regBlock(state, s) {
  const teams = (state && Array.isArray(state.teams) ? state.teams : [])
    .filter((x) => x && !x.is_hidden && x.code !== 'test');
  if (!teams.length) return null;
  const sorted = teams.slice().sort((a, b) => (Number(!!a.is_teachers) - Number(!!b.is_teachers))
    || ((a.pot || 9) - (b.pot || 9)) || ((a.id || 0) - (b.id || 0)));
  const conf = sorted.filter((x) => x.reg && x.reg.confirmed).length;
  const players = sorted.reduce((n, x) => n + (x.reg ? Number(x.reg.players) || 0 : 0), 0);
  return h('section', { class: 'hm-sec hm-reg' },
    h('h2', {}, s.open === false ? 'Бүртгэлийн дүн' : 'Бүртгэлийн явц'),
    h('p', { class: 'hm-reg-sum' },
      h('b', {}, `${conf}/${sorted.length}`), ' баг баталгаажсан · ', h('b', {}, `${players}/${sorted.length * 6}`), ' тоглогч'),
    h('div', { class: 'hm-chips' }, sorted.map(regChip)),
    h('p', { class: 'small muted' }, 'Зөвхөн тоо харагдана. Тоглогчийн нэр нийтэд харагдахгүй.'));
}

const LINKS = [
  ['#/schedule', 'Хуваарь', '2 өдрийн тоглолт'],
  ['#/groups', 'Хэсгүүд', 'Байр, оноо'],
  ['#/bracket', 'Схем', 'Шөвгийн 8 → финал'],
  ['#/rules', 'Удирдамж', 'Гол дүрэм'],
  ['#/draw', 'Сугалаа', '10.22, шалгах'],
  ['#/faq', 'Асуулт, хариулт', '14 асуулт'],
  ['#/downloads', 'Татах', 'Маягт, хуваарь'],
  ['#/privacy', 'Хувийн мэдээлэл', 'Юу цуглуулах вэ'],
];

export default async function render(root) {
  let cur = null;
  let offline = false;
  let cdEl = null;
  let cdTarget = NaN;
  let shownKey = '';

  const streamSlot = h('div', { class: 'hm-stream' });
  const nextSlot = h('div', {});
  const prizeSlot = h('div', {});
  const liveSlot = h('div', { class: 'hm-livelist' });
  const stepsSlot = h('div', {});
  const regSlot = h('div', {});
  const datesSlot = h('div', {});
  const formatSlot = h('div', {});
  const noteSlot = h('div', {});

  clear(root);
  root.appendChild(h('div', { class: 'pub hm' },
    h('section', { class: 'hero hm-hero' },
      h('p', { class: 'hm-kicker' }, `${SCHOOL} · 8–12-р анги`),
      h('h1', {}, EVENT_NAME),
      h('p', { class: 'hm-when' }, '2026.10.24–25 (Бямба, Ням)'),
      h('p', { class: 'muted' }, '12 баг · 20 тоглолт · Цомыг ганц баг өргөнө'),
      streamSlot),
    noteSlot, nextSlot, prizeSlot, stepsSlot, regSlot, datesSlot, formatSlot,
    h('nav', { class: 'hm-links', 'aria-label': 'Хуудсууд' },
      LINKS.map(([href, title, sub]) => h('a', { class: 'hm-link', href }, h('b', {}, title), h('span', {}, sub))))));

  // Статик хэсэг (систем, «Яаж оролцох»)
  contentFragment('home').then((frag) => {
    if (!stepsSlot.isConnected) return;
    fillConfig(frag);
    const steps = frag.querySelector('[data-slot="steps"]');
    const format = frag.querySelector('[data-slot="format"]');
    if (steps) stepsSlot.appendChild(steps);
    if (format) formatSlot.appendChild(format);
  }).catch(() => { /* статик хэсэггүйгээр үргэлжилнэ */ });

  function drawNext(now) {
    const s = settingsOf(cur);
    const ph = phase(now, cur);
    const next = milestones(s).find((m) => t(m.at) > now);
    const key = `${ph}|${next ? next.at : ''}`;
    if (key === shownKey && nextSlot.firstChild) return;
    shownKey = key;
    clear(nextSlot);
    cdEl = null;
    if (ph === 'day1' || ph === 'day2') {
      nextSlot.appendChild(h('section', { class: 'card hm-next live' },
        h('p', { class: 'hm-next-l' }, h('span', { class: 'chip pub-now' }, 'ОДОО'),
          ph === 'day1' ? ' 1-р өдөр: хэсгийн шат явагдаж байна' : ' 2-р өдөр: хасагдах шат явагдаж байна'),
        liveSlot,
        h('div', { class: 'pub-links' },
          h('a', { class: 'btn', href: '#/schedule' }, 'Хуваарь, оноо'),
          h('a', { class: 'btn secondary', href: ph === 'day1' ? '#/groups' : '#/bracket' }, ph === 'day1' ? 'Хэсгийн байр' : 'Схем'))));
      drawLive(now);
      return;
    }
    if (ph === 'over') {
      nextSlot.appendChild(h('section', { class: 'card hm-next over' },
        h('h2', {}, 'Тэмцээн өндөрлөлөө'),
        h('p', {}, 'Бүх оролцогч, багш, эцэг эхчүүдэд баярлалаа!'),
        h('a', { class: 'btn gold', href: '#/bracket' }, 'Шагналт байр')));
      return;
    }
    if (!next) return;
    cdTarget = t(next.at);
    cdEl = h('b', { class: 'countdown' }, '');
    nextSlot.appendChild(h('section', { class: 'card hm-next', 'aria-live': 'off' },
      h('p', { class: 'hm-next-l' }, next.label),
      cdEl,
      h('p', { class: 'muted small' }, dt(next.at))));
    tick();
  }

  async function drawLive(now) {
    if (!liveSlot.isConnected || !cur || offline) { clear(liveSlot); return; }
    try {
      const S = await import('./schedule.js');
      if (!liveSlot.isConnected) return;
      const rows = S.mergedMatches(cur);
      clear(liveSlot);
      for (const st of ['A', 'B']) {
        const { current, next } = S.stationNowNext(rows, st, now);
        const m = current || next;
        if (m) liveSlot.appendChild(S.matchCard(cur, m, now, { time: !current }));
      }
    } catch (e) {
      clear(liveSlot);   // logic ачаалагдаагүй бол товчлуурууд хангалттай
    }
  }

  function tick() {
    if (!cdEl || !cdEl.isConnected) return;
    const left = cdTarget - Date.now();
    if (left <= 0) { shownKey = ''; drawNext(Date.now()); return; }
    cdEl.textContent = fmtCountdown(left);
  }

  function drawAll() {
    const now = Date.now();
    const s = settingsOf(cur);
    clear(streamSlot);
    const sb = streamBtn(s);
    if (sb) streamSlot.appendChild(sb);
    clear(noteSlot);
    if (offline) {
      noteSlot.appendChild(h('div', { class: 'card warn', role: 'status' },
        h('p', {}, 'Шинэ мэдээлэл ачаалж чадсангүй. Интернэтээ шалгана уу.'),
        h('button', { class: 'btn secondary', type: 'button', onclick: (e) => { e.currentTarget.disabled = true; store.refresh(); } }, 'Дахин оролдох')));
    }
    shownKey = '';
    drawNext(now);
    clear(prizeSlot);
    prizeSlot.appendChild(prizeCard(s));
    // Бүрэлдэхүүн царцсаны дараа (10.23 23:59; сугалаа биш) бүртгэлийн алхам, явцыг нууж, хуваарь, дүнг түрүүлж харуулна.
    const frozen = now >= t(s.freeze);
    stepsSlot.hidden = frozen;
    clear(regSlot);
    const rb = offline || frozen ? null : regBlock(cur, s);
    if (rb) regSlot.appendChild(rb);
    clear(datesSlot);
    datesSlot.appendChild(keyDates(s, now));
  }

  const unsub = store.subscribe((state, meta) => {
    if (state) { cur = state; offline = false; } else if (meta && meta.error && !cur) { offline = true; }
    drawAll();
  });
  if (!store.get()) {
    const st = store.status();
    offline = !!st.error;
    drawAll();   // тогтмол огноогоор шууд зурна, өгөгдөл ирэхэд шинэчилнэ
  }
  const tSec = setInterval(tick, 1000);
  const tMin = setInterval(() => {
    const now = Date.now();
    drawNext(now);
    const ph = phase(now, cur);
    if (ph === 'day1' || ph === 'day2') drawLive(now);
  }, 30000);
  return () => { unsub(); clearInterval(tSec); clearInterval(tMin); };
}
