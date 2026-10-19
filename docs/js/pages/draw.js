// «Сугалаа» — Windows lab-ын том дэлгэцэнд зориулсан бүтэн дэлгэцийн хуудас (техникийн зөвлөгөөн, SPEC v6 §0b.4).
// Төлөв: none → committed (commit hash, «Ахлагч нар тоогоо бичиж байна») → computed/published
// (сагс сагсаар 4 хэсэгт үзүүлнэ; Space/товшилт/автомат) → «Шалгах» (logic.computeDraw-аар дахин тооцоолно).
import { h, clear, fmtCountdown } from '../ui.js';
import { store } from '../store.js';
import { PLACES } from '../config.js';
import { TEAMS, GROUPS, GROUP_LABEL, EVENT_NAME, DRAW_AT } from '../event.js';
import { computeDraw, sha256Hex, drawInputsString } from '../logic.js';
import { makeClock, nameByCode, tms, safe } from './schedule.js';

const POT_NAME = { 1: '1-р сагс', 2: '2-р сагс', 3: '3-р сагс' };
const STATUS_TEXT = {
  none: ['Эхлээгүй', 'pub-muted'],
  committed: ['Нууц тоо битүүмжлэгдсэн', 'warn'],
  computed: ['Сугалаа гарсан · нийтлэгдээгүй', 'warn'],
  published: ['Албан ёсны ✓', 'ok'],
};
const AUTO_MS = 2600;
const MIN = 60000;

const short = (hex, n = 12) => (hex ? `${String(hex).slice(0, n)}…` : '—');
const chunk = (hex) => (String(hex || '').match(/.{1,16}/g) || []);

function howSteps(doneUpTo) {
  const items = [
    'Зохион байгуулагч нууц тоогоо урьдчилан битүүмжилж (SHA-256), энд нийтэлнэ.',
    'Баг бүрийн ахлагч (эсвэл ангийн төлөөлөгч) 0–9999 хооронд дурын тоо бичнэ.',
    'Нууц тоо ба ахлагчдын тоогоор хэсгүүд гарна. Хэн ч дахин тооцоолж шалгаж болно.',
  ];
  return h('ol', { class: 'steps dr-how' }, items.map((t, i) => h('li', { class: i < doneUpTo ? 'done' : '' }, t)));
}

function potsBlock(state) {
  return h('section', { class: 'dr-pots', 'aria-label': 'Сагс' },
    [1, 2, 3].map((p) => h('div', { class: 'dr-pot' },
      h('b', {}, POT_NAME[p]),
      h('div', { class: 'dr-pot-teams' }, TEAMS.filter((t) => t.pot === p).map((t) => h('span', { class: 'dr-chip' }, nameByCode(state, t.code)))))));
}

function lastReason(draw, test) {
  const hist = Array.isArray(draw && draw.history) ? draw.history : [];
  for (let i = hist.length - 1; i >= 0; i -= 1) {
    const e = hist[i];
    if (e && e.reason && test(String(e.status || ''))) return String(e.reason);
  }
  return null;
}

async function verifyDraw(d) {
  if (!d.secret || !d.inputs) return { kind: 'manual' };
  try {
    const res = await computeDraw(String(d.secret), d.inputs);
    const commit = String(d.commit || '').toLowerCase();
    let commitOk = null;
    if (commit) {
      const a = await sha256Hex(String(d.secret));
      const b = await sha256Hex(String(d.secret).toLowerCase());
      commitOk = a === commit || b === commit;
    }
    const seedOk = d.seed ? res.seed === String(d.seed).toLowerCase() : null;
    const groupsOk = d.groups
      ? GROUPS.every((g) => JSON.stringify((res.groups || {})[g] || []) === JSON.stringify(d.groups[g] || []))
      : null;
    const ok = commitOk !== false && seedOk !== false && groupsOk !== false;
    return { kind: 'done', res, commitOk, seedOk, groupsOk, ok };
  } catch (e) {
    return { kind: 'error', message: String((e && e.message) || e) };
  }
}

export default async function render(root, params = {}) {
  const q = (params && params.query) || {};
  const forceReveal = q.reveal === '1';
  const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const clock = makeClock();
  store.setInterval(5000);

  let state = null;
  let d = { status: 'none' };
  let shownStatus = null;
  let sig = null;
  let seq = [];
  let step = 0;
  let autoTimer = null;
  let calc = null;            // verifyDraw-ийн үр дүн
  let calcSig = null;
  let lastSeen = null;
  let armed = false;
  const slots = new Map();
  const ui = {};

  const statusChip = h('span', { class: 'chip dr-status' });
  const netChip = h('span', { class: 'chip err dr-net', hidden: true }, 'Холболт тасарсан');
  const fsBtn = document.fullscreenEnabled
    ? h('button', {
      type: 'button', class: 'btn secondary dr-fs',
      onclick: (e) => {
        e.currentTarget.blur();
        try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch { /* ignore */ }
      },
    }, 'Бүтэн дэлгэц') : null;
  const main = h('div', { class: 'dr-main' });
  const live = h('div', { class: 'visually-hidden', 'aria-live': 'polite' });
  clear(root);
  root.appendChild(h('div', { class: 'dr' },
    h('header', { class: 'dr-top' },
      h('a', { class: 'dr-back', href: '#/' }, '‹ Нүүр'),
      h('div', { class: 'dr-title' }, h('b', {}, 'Хэсгийн сугалаа'), h('span', {}, EVENT_NAME)),
      statusChip, netChip, fsBtn),
    main, live));

  // ---------- төлөв бүрийн дэлгэц ----------
  function viewNone() {
    clear(main);
    const voided = lastReason(d, (s) => s.includes('void'));
    main.appendChild(h('section', { class: 'dr-hero' },
      h('h1', {}, 'Сугалаа 10.22 (Пүрэв) 16:00'),
      h('p', { class: 'dr-lead' }, `${PLACES.lab}-д техникийн зөвлөгөөнөөр, бүх ахлагч, менежерийн өмнө нээлттэй болно.`),
      h('p', { class: 'dr-cd' }, h('span', {}, 'Эхлэх хүртэл '), ui.cd = h('b', {}, '')),
      voided ? h('p', { class: 'dr-void' }, `Өмнөх сугалааг хүчингүй болгосон. Шалтгаан: ${voided}`) : null,
      howSteps(0)));
    main.appendChild(potsBlock(state));
    tick();
  }

  function viewCommitted() {
    clear(main);
    const voided = lastReason(d, (s) => s.includes('void'));
    main.appendChild(h('section', { class: 'dr-hero' },
      h('h1', {}, 'Нууц тоо битүүмжлэгдлээ'),
      h('p', { class: 'dr-lead' }, 'Битүүмжилсэн нууц тоо (commit, SHA-256):'),
      h('code', { class: 'dr-hash', 'aria-label': `Commit ${d.commit || ''}` }, chunk(d.commit).map((c) => h('span', {}, c))),
      h('p', { class: 'dr-wait' }, 'Ахлагч нар тоогоо бичиж байна', h('span', { class: 'dr-dots', 'aria-hidden': 'true' }, h('i', {}, '.'), h('i', {}, '.'), h('i', {}, '.'))),
      voided ? h('p', { class: 'dr-void' }, `Өмнөх сугалааг хүчингүй болгосон. Шалтгаан: ${voided}`) : null,
      howSteps(1)));
    main.appendChild(potsBlock(state));
  }

  function inputsGrid() {
    const inp = d.inputs || {};
    const codes = TEAMS.map((t) => t.code).filter((c) => inp[c] != null);
    if (!codes.length) return null;
    return h('div', { class: 'dr-inputs' },
      h('b', {}, 'Ахлагчдын бичсэн тоо'),
      h('div', { class: 'dr-inputs-grid' }, codes.map((c) => h('span', { class: 'dr-in' }, h('i', {}, nameByCode(state, c)), h('b', {}, String(inp[c]))))));
  }

  function viewReveal() {
    clear(main);
    slots.clear();
    const manual = !d.secret || !d.inputs;
    ui.potbar = h('div', { class: 'dr-potbar', 'aria-hidden': 'true' });
    ui.caption = h('div', { class: 'dr-caption' });
    ui.board = h('div', { class: 'dr-board' }, GROUPS.map((g) => h('div', { class: `dr-col gc-${g}` },
      h('div', { class: 'dr-col-h' }, `${GROUP_LABEL[g]} хэсэг`),
      [1, 2, 3].map((p) => {
        const name = h('b', { class: 'dr-slot-n' }, '');
        const el = h('div', { class: 'dr-slot' }, h('span', { class: 'dr-slot-l' }, `${GROUP_LABEL[g]}${p}`), name, h('span', { class: 'dr-slot-k' }, ''));
        slots.set(`${g}${p}`, el);
        return el;
      }))));
    ui.prev = h('button', { type: 'button', class: 'btn secondary', onclick: (e) => { e.currentTarget.blur(); stopAuto(); go(step - 1); } }, '‹ Буцах');
    ui.next = h('button', { type: 'button', class: 'btn gold dr-next', onclick: (e) => { e.currentTarget.blur(); stopAuto(); go(step + 1); } }, 'Дараах ›');
    ui.auto = h('button', { type: 'button', class: 'btn secondary', onclick: (e) => { e.currentTarget.blur(); if (autoTimer) stopAuto(); else startAuto(); } }, 'Автомат');
    ui.all = h('button', { type: 'button', class: 'btn secondary', onclick: (e) => { e.currentTarget.blur(); stopAuto(); go(seq.length); } }, 'Бүгдийг харуулах');
    ui.prog = h('span', { class: 'dr-prog' }, '');
    ui.verifyBtn = h('button', {
      type: 'button', class: 'btn dr-vbtn',
      onclick: (e) => { e.currentTarget.blur(); if (ui.verify) ui.verify.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); },
    }, 'Шалгах ↓');
    const stage = h('section', {
      class: 'dr-stage',
      onclick: (e) => { if (e.target.closest('button, a, summary, details')) return; stopAuto(); go(step + 1); },
    },
    ui.potbar, ui.caption, ui.board,
    h('div', { class: 'dr-ctrl' }, ui.prev, ui.next, ui.auto, ui.all, ui.prog, ui.verifyBtn),
    h('p', { class: 'dr-keys' }, 'Space эсвэл товшилт — дараах · ← — буцах · A — автомат · End — бүгд'));
    main.appendChild(stage);
    ui.verify = h('section', { class: 'dr-verify', 'aria-label': 'Шалгах' });
    main.appendChild(ui.verify);
    if (manual) {
      const why = lastReason(d, () => true);
      main.insertBefore(h('p', { class: 'dr-void' }, 'Энэ сугалааг биет аргаар (гараар) хийсэн.', why ? ` Шалтгаан: ${why}` : ''), stage);
    }
    update(false);
    renderVerify();
  }

  // ---------- алхам ----------
  function currentGroups() {
    if (d.groups) return d.groups;
    if (calc && calc.kind === 'done' && calc.res && calc.res.groups) return calc.res.groups;
    return null;
  }
  function buildSeq() {
    const g = currentGroups();
    const out = [];
    if (!g) return out;
    for (const pot of [1, 2, 3]) {
      for (const grp of GROUPS) {
        const code = Array.isArray(g[grp]) ? g[grp][pot - 1] : null;
        if (code) out.push({ pot, grp, code });
      }
    }
    return out;
  }
  const keyOf = (code) => (calc && calc.kind === 'done' && calc.res && calc.res.keys ? calc.res.keys[code] : null);

  function update(forward) {
    if (!ui.board) return;
    const n = seq.length;
    seq.forEach((s, i) => {
      const el = slots.get(`${s.grp}${s.pot}`);
      if (!el) return;
      const on = i < step;
      el.classList.toggle('on', on);
      const nm = on ? nameByCode(state, s.code) : '';
      const nEl = el.querySelector('.dr-slot-n');
      nEl.textContent = nm;
      nEl.classList.toggle('long', [...nm].length > 6);   // «Багш нарын баг»: smaller on phones, no mid-word break
      const k = keyOf(s.code);
      el.querySelector('.dr-slot-k').textContent = on && k ? short(k, 8) : '';
      el.classList.remove('pop');
    });
    if (forward && step > 0 && !reduce) {
      const s = seq[step - 1];
      const el = slots.get(`${s.grp}${s.pot}`);
      if (el) { void el.offsetWidth; el.classList.add('pop'); }
    }
    // Сагсны мөр
    const pot = step < n ? (seq[step] ? seq[step].pot : 1) : (n ? seq[n - 1].pot : 1);
    const placed = new Map(seq.slice(0, step).map((s) => [s.code, s.grp]));
    clear(ui.potbar);
    ui.potbar.appendChild(h('b', { class: 'dr-potname' }, step >= n && n ? 'Бүх сагс дууслаа' : POT_NAME[pot]));
    if (!(step >= n && n)) {
      for (const t of TEAMS.filter((x) => x.pot === pot)) {
        const g = placed.get(t.code);
        ui.potbar.appendChild(h('span', { class: `dr-chip${g ? ` used gc-${g}` : ''}` }, nameByCode(state, t.code), g ? h('i', {}, ` → ${GROUP_LABEL[g]}`) : null));
      }
    }
    // Тайлбар
    clear(ui.caption);
    if (step === 0) {
      ui.caption.appendChild(h('p', {}, 'Сагс бүрээс түлхүүр нь хамгийн бага баг А хэсэгт, дараагийнх нь Б, В, Г хэсэгт орно.'));
      const grid = inputsGrid();
      if (grid) ui.caption.appendChild(grid);
    } else {
      const s = seq[step - 1];
      const k = keyOf(s.code);
      ui.caption.appendChild(h('p', { class: `dr-last gc-${s.grp}` },
        h('span', { class: 'dr-last-g' }, `${GROUP_LABEL[s.grp]} хэсэг`), h('span', { class: 'dr-arrow', 'aria-hidden': 'true' }, '←'),
        h('b', {}, nameByCode(state, s.code)),
        k ? h('span', { class: 'dr-last-k' }, `түлхүүр ${short(k, 10)}`) : null));
      live.textContent = `${GROUP_LABEL[s.grp]} хэсэг: ${nameByCode(state, s.code)}`;
    }
    ui.prog.textContent = `${step} / ${n}`;
    ui.prev.disabled = step === 0;
    ui.next.disabled = step >= n;
    ui.next.textContent = step === 0 ? 'Эхлүүлэх ›' : 'Дараах ›';
    ui.all.disabled = step >= n;
    ui.auto.textContent = autoTimer ? 'Зогсоох' : 'Автомат';
    ui.auto.disabled = step >= n;
    ui.verifyBtn.hidden = !(n && step >= n);
    if (ui.verify) ui.verify.hidden = !(n && step >= n);
  }
  function go(n) {
    const max = seq.length;
    const next = Math.max(0, Math.min(max, n));
    if (next === step) return;
    const forward = next > step;
    step = next;
    if (step >= max) stopAuto();
    update(forward);
  }
  function startAuto() {
    if (step >= seq.length) return;
    autoTimer = setInterval(() => { if (step >= seq.length) stopAuto(); else go(step + 1); }, AUTO_MS);
    if (step === 0) go(1);
    update(false);
  }
  function stopAuto() {
    if (!autoTimer) return;
    clearInterval(autoTimer);
    autoTimer = null;
    if (ui.auto) ui.auto.textContent = 'Автомат';
  }

  // ---------- шалгах ----------
  function row(label, value, ok) {
    return h('div', { class: 'dr-vrow' },
      h('span', { class: 'dr-vl' }, label),
      h('code', { class: 'dr-vv' }, value || '—'),
      ok == null ? h('span', { class: 'dr-vok' }, '') : h('span', { class: `dr-vok ${ok ? 'ok' : 'bad'}` }, ok ? '✓' : '✗'));
  }
  function renderVerify() {
    const box = ui.verify;
    if (!box) return;
    clear(box);
    box.appendChild(h('h2', {}, 'Шалгах'));
    if (!d.secret || !d.inputs) {
      box.appendChild(h('p', { class: 'dr-verdict pub-muted' }, 'Биет сугалаа тул тооцоолж шалгах боломжгүй.'));
      return;
    }
    if (!calc) { box.appendChild(h('p', { class: 'dr-verdict' }, 'Шалгаж байна…')); return; }
    if (calc.kind === 'error') {
      box.appendChild(h('p', { class: 'dr-verdict bad' }, 'Энэ төхөөрөмж дээр тооцоолж чадсангүй.'));
      box.appendChild(h('p', { class: 'small' }, calc.message));
      return;
    }
    const r = calc.res;
    box.appendChild(h('p', { class: `dr-verdict ${calc.ok ? 'ok' : 'bad'}` },
      calc.ok ? 'Таарч байна ✓' : 'Таарахгүй байна ✗',
      calc.ok ? null : h('span', {}, ' Зохион байгуулагчид мэдэгдэнэ үү.')));
    const inputsStr = r.inputs || safe(() => drawInputsString(d.inputs), '') || '';
    box.appendChild(h('div', { class: 'dr-vgrid' },
      row('Commit (урьдчилан нийтэлсэн)', d.commit, null),
      row('Нууц тоо (secret)', d.secret, null),
      row('SHA-256(secret) = commit', calc.commitOk == null ? 'commit алга' : (calc.commitOk ? 'таарч байна' : 'таарахгүй'), calc.commitOk),
      row('Ахлагчдын тоо (inputs)', inputsStr, null),
      row('Seed (дахин тооцоолсон)', r.seed, calc.seedOk),
      row('Хэсгүүд', GROUPS.map((g) => `${GROUP_LABEL[g]}: ${((r.groups || {})[g] || []).map((c) => nameByCode(state, c)).join(', ')}`).join(' · '), calc.groupsOk)));
    box.appendChild(h('p', { class: 'dr-formula small' },
      'seed = SHA-256("cs2draw-v1|" + secret + "|" + inputs). Түлхүүр = SHA-256(seed + "|" + багийн код). ',
      'Сагс бүрт түлхүүрээр өсөхөөр эрэмбэлж А, Б, В, Г хэсэгт хуваарилна.'));
    const keys = r.keys || {};
    box.appendChild(h('div', { class: 'dr-keysgrid' }, [1, 2, 3].map((p) => {
      const teams = TEAMS.filter((t) => t.pot === p).map((t) => ({ code: t.code, key: String(keys[t.code] || '') }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      return h('div', { class: 'dr-keypot' },
        h('b', {}, POT_NAME[p]),
        h('ol', {}, teams.map((t, i) => h('li', { class: `gc-${GROUPS[i]}` },
          h('span', { class: 'dr-kt' }, nameByCode(state, t.code)),
          h('code', { title: t.key }, short(t.key, 14)),
          h('span', { class: 'dr-kg' }, `→ ${GROUP_LABEL[GROUPS[i]]}`)))));
    })));
  }

  // ---------- өгөгдөл ----------
  function recompute(mySig) {
    if (!d.secret || !d.inputs) { calc = null; calcSig = mySig; return; }
    if (calcSig === mySig) return;
    calcSig = mySig;
    calc = null;
    const snapshot = d;
    verifyDraw(snapshot).then((res) => {
      if (sig !== mySig) return;
      const hadGroups = !!currentGroups();
      calc = res;
      if (!hadGroups && currentGroups()) { seq = buildSeq(); step = reduce ? seq.length : 0; viewReveal(); return; }
      update(false);
      renderVerify();
    });
  }

  function onState(s, meta) {
    if (s && armed && s !== lastSeen && !(meta && meta.error)) clock.observe(s);
    if (s) lastSeen = s;
    state = s;
    d = (s && s.draw) || { status: 'none' };
    const status = STATUS_TEXT[d.status] ? d.status : 'none';
    const [txt, cls] = STATUS_TEXT[status];
    statusChip.className = `chip dr-status ${cls}`;
    statusChip.textContent = txt;
    const newSig = JSON.stringify([d.groups || null, d.seed || null, d.secret || null, d.inputs || null, d.commit || null]);
    const reveal = status === 'computed' || status === 'published';
    if (!reveal) {
      stopAuto();
      if (status !== shownStatus || newSig !== sig) {
        sig = newSig; shownStatus = status; ui.board = null;
        if (status === 'committed') viewCommitted(); else viewNone();
      }
      return;
    }
    if (newSig !== sig || !(shownStatus === 'computed' || shownStatus === 'published')) {
      if (newSig !== sig) { calc = null; calcSig = null; }
      sig = newSig;
      shownStatus = status;
      stopAuto();
      seq = buildSeq();
      const pubAt = (Array.isArray(d.history) ? d.history : []).filter((e) => e && e.status === 'published').map((e) => tms(e.at)).filter(Number.isFinite).pop();
      const old = status === 'published' && (!pubAt || clock.now() - pubAt > 10 * MIN);
      step = (reduce || (old && !forceReveal)) ? seq.length : 0;
      viewReveal();
      recompute(newSig);
      return;
    }
    shownStatus = status;   // computed → published: харуулж буй алхмыг хадгална
  }

  function tick() {
    const st = store.status();
    netChip.hidden = !(st.lastOkAt ? Date.now() - st.lastOkAt > 30000 : !!st.error);
    if (!ui.cd || !ui.cd.isConnected) return;
    const left = tms(DRAW_AT) - clock.now();
    ui.cd.textContent = left > 0 ? fmtCountdown(left) : 'удахгүй эхэлнэ';
  }

  // ---------- гар, хулгана ----------
  const onKey = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (!ui.board || !ui.board.isConnected) return;
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, select')) return;
    const onBtn = t && t.closest && t.closest('button, a, summary');
    const c = e.code;
    const k = e.key;
    if ((c === 'Space' || k === 'Enter') && onBtn) return;            // товчлуур өөрөө ажиллана
    if (c === 'Space' || k === 'Enter' || k === 'ArrowRight' || k === 'PageDown') { e.preventDefault(); stopAuto(); go(step + 1); }
    else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace') { e.preventDefault(); stopAuto(); go(step - 1); }
    else if (k === 'End') { e.preventDefault(); stopAuto(); go(seq.length); }
    else if (k === 'Home') { e.preventDefault(); stopAuto(); go(0); }
    else if (c === 'KeyA') { if (autoTimer) stopAuto(); else startAuto(); }
  };
  document.addEventListener('keydown', onKey);
  let idleT = null;
  const onMove = () => {
    document.body.classList.remove('pub-idle');
    clearTimeout(idleT);
    idleT = setTimeout(() => document.body.classList.add('pub-idle'), 3000);
  };
  document.addEventListener('mousemove', onMove);

  const unsub = store.subscribe(onState);
  armed = true;
  if (!store.get()) onState(null, store.status());   // холболтгүй үед ч сагс, аргачлалыг харуулна
  const cdTimer = setInterval(tick, 1000);

  return () => {
    unsub();
    stopAuto();
    clearInterval(cdTimer);
    clearTimeout(idleT);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('mousemove', onMove);
    document.body.classList.remove('pub-idle');
    store.setInterval(20000);
  };
}
