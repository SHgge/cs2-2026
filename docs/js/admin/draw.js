// 5. Сугалаа — нууц тоо + commit (өмнө нь), 12 тоо + нууц тоо → урьдчилан харах → сервер тооцоолох → нийтлэх;
// хүчингүй болгох, гар сугалаа (нөөц), draw.json (зурагт хуудас) ба CSV татах.
import { h, toast, fmtDateTime } from '../ui.js';
import { btn, section, chip, confirmDialog, download, DRAW_STATUS } from './core.js';
import { vault } from './vault.js';
import {
  randomSecretHex, normalizeSecret, isSecretHex, hexCandidates, secretGroups, posterDrawJson, drawCsvRows,
  toCsv, manualGroupsError, fileStamp, shortDateTime, SEAT_CYR, DRAW_GROUPS,
} from './util.js';
import { sha256Hex, computeDraw, parseDrawNum } from '../logic.js';
import { DRAW_ORDER } from '../event.js';

const sameGroups = (a, b) => !!a && !!b && DRAW_GROUPS.every((g) => JSON.stringify(a[g] || []) === JSON.stringify(b[g] || []));

function secretFileText(v) {
  return [
    'Ангийн аварга – CS2 2026 — сугалааны нууц тоо',
    '',
    `Нууц тоо (secret): ${v.secret}`,
    `Commit (sha256): ${v.commit}`,
    `Үүсгэсэн: ${shortDateTime(v.at)}`,
    '',
    'Сугалаа (10.22 16:00) хүртэл энэ файлыг хэнд ч бүү үзүүлнэ үү.',
    'Сугалааны үед нууц тоог админ хуудсанд оруулна (эсвэл энэ файлыг сонгоно).',
    'Нууц тоо commit-тэй таарч байгааг хүн бүр шалгаж болно.',
    '',
  ].join('\r\n');
}

function groupsView(groups, ctx, cls = '') {
  const name = (code) => { const t = ctx.teamByCode(code); return t ? t.name : code; };
  return h('div', { class: `adm-groups ${cls}`.trim() }, DRAW_GROUPS.map((g) => h('div', { class: `adm-gbox grp-${g}` },
    h('h3', {}, `${SEAT_CYR[g]} хэсэг`),
    h('ol', {}, ((groups && groups[g]) || []).map((code, i) => h('li', {}, h('b', {}, `${SEAT_CYR[g]}${i + 1}`), h('span', {}, name(code))))))));
}

function exportsBox(ctx, groups) {
  return h('div', { class: 'row adm-mt' },
    btn('draw.json татах (зурагт хуудас)', () => {
      download('draw.json', `${JSON.stringify(posterDrawJson(groups, ctx.state.teams), null, 2)}\n`, 'application/json;charset=utf-8');
      toast('draw.json татлаа', 'ok');
    }),
    btn('CSV татах', () => {
      const { columns, rows } = drawCsvRows(groups, ctx.state.teams);
      download(`cs2_sugalaa_${fileStamp()}.csv`, toCsv(columns, rows), 'text/csv;charset=utf-8');
    }, 'secondary'),
    h('p', { class: 'muted small adm-w100' }, 'Зурагт хуудас: файлыг _build/draw.json нэрээр хадгалаад «python _build/poster_huvaari.py» ажиллуулна уу.'));
}

/* ---- step 1: secret + commit (status none) ---- */
function stepCommit(ctx) {
  const v = vault.draw();
  const box = section('1. Нууц тоо (сугалаанаас өмнө)',
    h('p', {}, 'Нууц тоог үүсгээд хадгална уу. Түүний hash (commit)-ийг урьдчилан нийтэлснээр сугалааг хэн ч дараа нь өөрчилж чадахгүй.'));
  if (!v) {
    box.appendChild(btn('Нууц тоо үүсгэх', async () => {
      const s = randomSecretHex(32);
      vault.setDraw(s, await sha256Hex(s));
      ctx.rerender();
    }));
    return box;
  }
  box.append(
    h('div', { class: 'adm-secret' }, h('span', { class: 'muted small' }, 'Нууц тоо (бусдад бүү үзүүлнэ үү)'), h('code', {}, secretGroups(v.secret, 8))),
    h('div', { class: 'adm-secret' }, h('span', { class: 'muted small' }, 'Commit (нийтэд ил)'), h('code', {}, v.commit)),
    h('div', { class: 'row adm-mt' },
      btn('.txt татах', () => { download(`cs2_sugalaa_nuuts_${fileStamp()}.txt`, secretFileText(v)); vault.markDrawSaved(); ctx.rerender(); }, 'secondary'),
      btn('Хэвлэх', () => { location.hash = '#/print/secret'; }, 'secondary'),
      v.saved ? chip('Хадгалсан', 'ok') : chip('Эхлээд татах эсвэл хэвлэнэ үү', 'warn')),
    h('div', { class: 'row adm-mt' },
      btn('Commit илгээх', async () => {
        const ok = await confirmDialog({
          title: 'Commit илгээх үү?',
          text: ['Илгээсний дараа энэ нууц тоог л ашиглана.', 'Нууц тоог алдвал сугалааг хүчингүй болгож дахин эхлүүлнэ.'],
          ok: 'Илгээх',
        });
        if (ok) await ctx.act('draw_commit', { commit: v.commit }, 'Commit илгээлээ');
      }, '', { disabled: !v.saved }),
      btn('Шинээр үүсгэх', async () => {
        const ok = await confirmDialog({ title: 'Шинэ нууц тоо үүсгэх үү?', text: 'Одоогийн нууц тоо устна.', ok: 'Үүсгэх', danger: true });
        if (!ok) return;
        const s = randomSecretHex(32);
        vault.setDraw(s, await sha256Hex(s));
        ctx.rerender();
      }, 'secondary')));
  return box;
}

/* ---- step 2: numbers + secret (status committed) ---- */
function stepCompute(ctx, ui, d) {
  if (!ui.nums) ui.nums = {};
  if (ui.commit !== d.commit) { ui.commit = d.commit; ui.secret = ''; ui.preview = null; } // a new commit → old secret/preview no longer apply
  if (!ui.secret) { const v = vault.draw(); if (v && v.commit === d.commit) ui.secret = v.secret; }
  const numInputs = {};
  const grid = h('div', { class: 'adm-nums' }, DRAW_ORDER.map((code) => {
    const t = ctx.teamByCode(code);
    const inp = h('input', {
      type: 'text', inputmode: 'numeric', maxlength: 4, autocomplete: 'off', class: 'adm-num', id: `adm-num-${code}`,
    });
    inp.value = ui.nums[code] == null ? '' : String(ui.nums[code]);
    inp.addEventListener('input', () => {
      ui.nums[code] = inp.value.trim();
      inp.classList.toggle('input-error', inp.value.trim() !== '' && parseDrawNum(inp.value) == null);
      ui.preview = null;
      previewBox.textContent = '';
    });
    numInputs[code] = inp;
    return h('label', { class: 'adm-numcell', for: `adm-num-${code}` }, h('span', {}, t ? t.name : code), inp);
  }));

  const secretIn = h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', class: 'adm-mono', id: 'adm-secret-in', placeholder: '64 тэмдэгт (0–9, a–f)' });
  secretIn.value = ui.secret || '';
  const check = h('p', { class: 'small', 'aria-live': 'polite' });
  let checkSeq = 0;
  const runCheck = async () => {
    const seq = ++checkSeq;
    const s = normalizeSecret(secretIn.value);
    ui.secret = s;
    if (!s) { check.textContent = ''; return false; }
    if (!isSecretHex(s)) { check.className = 'small field-error'; check.textContent = '64 тэмдэгт (0–9, a–f) байх ёстой.'; return false; }
    const ok = (await sha256Hex(s)) === d.commit;
    if (seq !== checkSeq) return ok;
    check.className = ok ? 'small adm-okline' : 'small field-error';
    check.textContent = ok ? '✓ Commit-тэй таарч байна.' : 'Commit-тэй таарахгүй байна. Нууц тоогоо шалгана уу.';
    return ok;
  };
  secretIn.addEventListener('input', () => { ui.preview = null; previewBox.textContent = ''; runCheck(); });
  const file = h('input', { type: 'file', accept: '.txt,text/plain', class: 'adm-file', 'aria-label': 'Нууц тооны файл' });
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    file.value = '';
    if (!f) return;
    const text = await f.text();
    let found = null;
    for (const c of hexCandidates(text)) if ((await sha256Hex(c)) === d.commit) { found = c; break; }
    if (!found) { toast('Файлаас commit-тэй таарах нууц тоо олдсонгүй.', 'err', 5000); return; }
    secretIn.value = found;
    ui.preview = null;
    previewBox.textContent = '';
    await runCheck();
    toast('Нууц тоог файлаас уншлаа', 'ok');
  });

  const previewBox = h('div', { 'aria-live': 'polite' });
  const collect = async () => {
    const nums = {};
    const bad = [];
    for (const code of DRAW_ORDER) {
      const n = parseDrawNum(numInputs[code].value);
      numInputs[code].classList.toggle('input-error', n == null);
      if (n == null) bad.push(code); else nums[code] = n;
    }
    if (bad.length) { toast(`${bad.length} багийн тоо дутуу эсвэл буруу (0–9999).`, 'err'); numInputs[bad[0]].focus(); return null; }
    if (!(await runCheck())) { toast('Нууц тоо commit-тэй таарахгүй байна.', 'err'); secretIn.focus(); return null; }
    return { nums, secret: normalizeSecret(secretIn.value) };
  };
  const showPreview = (res) => {
    previewBox.textContent = '';
    previewBox.append(
      h('h3', {}, 'Урьдчилсан үр дүн (энэ компьютер дээр)'),
      groupsView(res.groups, ctx),
      h('p', { class: 'muted small adm-break' }, `Seed: ${res.seed}`));
  };
  if (ui.preview) showPreview(ui.preview.result);

  if (ui.secret) runCheck();
  return section('2. Сугалааны үед (10.22 16:00)',
    h('p', {}, 'Баг бүрийн ахлагч 0–9999 хооронд тоо хэлнэ. Тоог нэг бүрчлэн оруулаад, нууц тоогоо оруулна уу.'),
    h('div', { class: 'adm-secret' }, h('span', { class: 'muted small' }, 'Commit (нийтэлсэн)'), h('code', {}, d.commit || '—')),
    grid,
    h('label', { for: 'adm-secret-in' }, 'Нууц тоо'),
    h('div', { class: 'row' }, secretIn, h('label', { class: 'btn secondary adm-filebtn' }, 'Файлаас унших', file)),
    check,
    h('div', { class: 'row adm-mt' },
      btn('Урьдчилж харах', async () => {
        const inp = await collect();
        if (!inp) return;
        const result = await computeDraw(inp.secret, inp.nums);
        ui.preview = { ...inp, result };
        showPreview(result);
      }, 'secondary'),
      btn('Серверээр тооцоолох', async () => {
        const inp = await collect();
        if (!inp) return;
        if (!ui.preview) { const result = await computeDraw(inp.secret, inp.nums); ui.preview = { ...inp, result }; showPreview(result); }
        const ok = await confirmDialog({
          title: 'Серверээр тооцоолох уу?',
          text: ['Тоонууд, нууц тоо серверт очиж, хэсгүүд тооцоологдоно.', 'Дараа нь үр дүнг шалгаад «Нийтлэх» дарна.'],
          ok: 'Тооцоолох',
        });
        if (!ok) return;
        const r = await ctx.act('draw_compute', { secret: inp.secret, inputs: inp.nums }, 'Тооцооллоо. Үр дүнг шалгана уу.');
        if (r.ok) vault.markDrawSaved();
      })),
    previewBox);
}

/* ---- step 3/4: computed / published ---- */
function stepResult(ctx, ui, d) {
  const box = section(d.status === 'published' ? 'Сугалааны үр дүн (нийтэлсэн)' : '3. Үр дүнг шалгаад нийтлэх', groupsView(d.groups, ctx));
  if (ui.preview && ui.preview.result) {
    const same = sameGroups(ui.preview.result.groups, d.groups);
    box.appendChild(h('p', { class: same ? 'adm-okline' : 'field-error' },
      same ? '✓ Серверийн үр дүн урьдчилсан тооцоотой таарч байна.' : 'Анхаар: серверийн үр дүн урьдчилсан тооцооноос өөр байна!'));
  }
  const inputs = d.inputs || {};
  if (Object.keys(inputs).length) {
    box.appendChild(h('details', {}, h('summary', {}, 'Тоонууд, seed, commit'),
      h('ul', { class: 'adm-inputs' }, DRAW_ORDER.filter((c) => inputs[c] != null).map((c) => {
        const t = ctx.teamByCode(c);
        return h('li', {}, h('span', {}, t ? t.name : c), h('b', {}, String(inputs[c])));
      })),
      d.seed ? h('p', { class: 'small adm-break' }, `Seed: ${d.seed}`) : null,
      d.commit ? h('p', { class: 'small adm-break' }, `Commit: ${d.commit}`) : null,
      d.secret ? h('p', { class: 'small adm-break' }, `Нууц тоо: ${d.secret}`) : null));
  }
  if (d.status === 'computed') {
    box.appendChild(h('div', { class: 'row adm-mt' },
      btn('Нийтлэх', async () => {
        const ok = await confirmDialog({
          title: 'Сугалааны үр дүнг нийтлэх үү?', text: 'Хэсэг, суудал бүх хуудсанд гарна. Тоглолтын хуваарь багуудаар бөглөгдөнө.', ok: 'Нийтлэх',
        });
        if (ok) await ctx.act('draw_publish', {}, 'Нийтэллээ');
      }, 'gold')));
  }
  box.appendChild(exportsBox(ctx, d.groups));
  return box;
}

function voidBox(ctx, ui, d) {
  const started = (ctx.state.matches || []).some((m) => m.stage === 'group' && m.status && m.status !== 'scheduled');
  return h('details', { class: 'adm-danger' },
    h('summary', {}, 'Сугалааг хүчингүй болгох'),
    h('p', { class: 'small' }, d.status === 'committed'
      ? 'Нууц тоо алдагдсан бол хүчингүй болгоод шинээр эхлүүлнэ үү.'
      : 'Хэсгийн тоглолт эхэлсэн бол хүчингүй болгох боломжгүй.'),
    btn('Хүчингүй болгох', async () => {
      const reason = await confirmDialog({
        title: 'Сугалааг хүчингүй болгох уу?', text: 'Шалтгаан нь түүхэнд хадгалагдаж, нийтэд харагдана.', ok: 'Хүчингүй болгох', danger: true,
        input: { label: 'Шалтгаан', required: true, min: 5 },
      });
      if (!reason) return;
      const r = await ctx.act('draw_void', { reason }, 'Хүчингүй болголоо', { reload: false });
      if (r.ok) { vault.clearDraw(); ui.preview = null; ui.secret = ''; await ctx.reload(); } // a new draw starts with a new secret
    }, 'danger', { disabled: started }));
}

function manualBox(ctx, ui) {
  if (!ui.manual) ui.manual = { A: ['', '', ''], B: ['', '', ''], V: ['', '', ''], G: ['', '', ''] };
  const teams = ctx.teams();
  const selects = [];
  const grid = h('div', { class: 'adm-groups' }, DRAW_GROUPS.map((g) => h('div', { class: `adm-gbox grp-${g}` },
    h('h3', {}, `${SEAT_CYR[g]} хэсэг`),
    [0, 1, 2].map((i) => {
      const sel = h('select', { 'aria-label': `${SEAT_CYR[g]}${i + 1} суудал` },
        h('option', { value: '' }, `${SEAT_CYR[g]}${i + 1} — ${i + 1}-р сагс`),
        teams.filter((t) => Number(t.pot) === i + 1).map((t) => h('option', { value: t.code }, t.name)));
      sel.value = ui.manual[g][i] || '';
      sel.addEventListener('change', () => { ui.manual[g][i] = sel.value; });
      selects.push(sel);
      return h('label', { class: 'adm-seat' }, h('b', {}, `${SEAT_CYR[g]}${i + 1}`), sel);
    }))));
  const reason = h('input', { type: 'text', maxlength: 200, placeholder: 'Жишээ: Компьютер ажиллаагүй, хайрцгаас сугалсан' });
  return h('details', { class: 'card adm-sec' },
    h('summary', {}, 'Гар сугалаа (нөөц арга)'),
    h('p', { class: 'small' }, 'Компьютер, интернэт ажиллахгүй бол сагс бүрээс хайрцгаар сугалаад үр дүнг энд оруулна уу. Шууд нийтлэгдэнэ.'),
    grid,
    h('label', {}, 'Шалтгаан', reason),
    h('div', { class: 'row adm-mt' }, btn('Гар сугалааг нийтлэх', async () => {
      const groups = {};
      for (const g of DRAW_GROUPS) groups[g] = ui.manual[g].slice();
      const err = manualGroupsError(groups, teams);
      if (err) { toast(err, 'err', 6000); return; }
      if (reason.value.trim().length < 5) { toast('Шалтгааныг бичнэ үү.', 'err'); reason.focus(); return; }
      const ok = await confirmDialog({ title: 'Гар сугалааг нийтлэх үү?', text: 'Хэсгүүд шууд нийтэд харагдана.', ok: 'Нийтлэх', danger: true });
      if (ok) await ctx.act('draw_manual', { groups, reason: reason.value.trim() }, 'Нийтэллээ');
    }, 'gold')));
}

export function render(panel, ctx, ui) {
  const d = ctx.state.draw || { status: 'none' };
  // After «computed» the secret is public (shown on #/draw for checking) — no need to keep it in memory.
  if ((d.status === 'computed' || d.status === 'published') && vault.draw()) vault.clearDraw();
  const [stText, stKind] = DRAW_STATUS[d.status] || [d.status || '—', ''];
  panel.appendChild(h('div', { class: 'row adm-sec-plain' }, h('h2', {}, 'Сугалаа'), chip(stText, stKind)));

  if (d.status === 'none' || !d.status) panel.appendChild(stepCommit(ctx));
  else if (d.status === 'committed') panel.appendChild(stepCompute(ctx, ui, d));
  else panel.appendChild(stepResult(ctx, ui, d));

  if (d.status && d.status !== 'none') panel.appendChild(voidBox(ctx, ui, d));
  if (d.status !== 'published' && d.status !== 'computed') panel.appendChild(manualBox(ctx, ui));

  const hist = Array.isArray(d.history) ? d.history : [];
  if (hist.length) {
    panel.appendChild(section('Түүх', h('ul', { class: 'adm-hist' }, hist.map((x) => {
      const [t] = DRAW_STATUS[x.status] || [x.status === 'void' ? 'Хүчингүй' : x.status];
      return h('li', {}, h('span', { class: 'muted small' }, fmtDateTime(x.at)), ' ', h('b', {}, t || '—'), x.reason ? ` — ${x.reason}` : '');
    }))));
  }
}
