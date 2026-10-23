// Admin helpers (docs/js/admin/util.js) — pure functions, synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CSV_BOM, csvCell, toCsv, posterDrawJson, drawCsvRows, manualGroupsError, autoAliasPlan, aliasFor, needsAlias,
  rosterCheck, playerErrors, forfeitScore, isOvertime, classLink, refLink, pinMessage, validationText, normalizeSecret,
  isSecretHex, hexCandidates, localInputToIso, isoToLocalInput, shortDateTime,
} from '../docs/js/admin/util.js';
import { computeDraw, validScore, sha256Hex } from '../docs/js/logic.js';
import { TEAMS } from '../docs/js/event.js';
import { VECTOR } from './fixtures.mjs';

test('CSV: BOM, CRLF, quoting and formula-injection guard', () => {
  assert.equal(CSV_BOM, '﻿');
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell('+7'), "'+7");
  assert.equal(csvCell('-1'), "'-1");
  assert.equal(csvCell('@x'), "'@x");
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell(5), '5');
  assert.equal(csvCell(-5), '-5');                     // numbers stay numbers
  assert.equal(csvCell(null), '');
  const out = toCsv(['Баг', 'Нэр'], [['12а', '=1+1'], ['8б', 'Бат']]);
  assert.ok(out.startsWith('﻿Баг,Нэр\r\n'));
  assert.ok(out.includes("12а,'=1+1\r\n"));
});

test('draw.json for the poster: Cyrillic seat keys from the CONTRACT vector', async () => {
  const r = await computeDraw(VECTOR.secret, VECTOR.nums);
  assert.equal(r.seed, VECTOR.seed);
  const j = posterDrawJson(r.groups, TEAMS);
  assert.deepEqual(Object.keys(j), ['А1', 'А2', 'А3', 'Б1', 'Б2', 'Б3', 'В1', 'В2', 'В3', 'Г1', 'Г2', 'Г3']);
  for (const k of Object.keys(j)) assert.ok(k.charCodeAt(0) >= 0x410 && k.charCodeAt(0) <= 0x413, k);
  assert.equal(j['А1'], 'Багш нарын баг');
  assert.equal(j['Б1'], '12а');
  assert.equal(j['Г3'], '8б');
  assert.equal(drawCsvRows(r.groups, TEAMS).rows[0].join('|'), 'А хэсэг|А1|Багш нарын баг|1-р сагс');
  assert.equal(manualGroupsError(r.groups, TEAMS), null);
  assert.match(manualGroupsError({ ...r.groups, A: ['9a', 'teachers', '9b'] }, TEAMS), /сагс/);
  assert.match(manualGroupsError({ ...r.groups, B: ['12a', '10b', ''] }, TEAMS), /Бүх суудлыг/);
});

test('secret helpers', async () => {
  assert.equal(normalizeSecret('0011 2233-AABB'), '00112233aabb');
  assert.ok(isSecretHex(VECTOR.secret));
  assert.deepEqual(hexCandidates(`x ${VECTOR.secret.toUpperCase()} y`), [VECTOR.secret]);
  assert.equal((await sha256Hex(VECTOR.secret)).length, 64);
});

test('aliases: 3а or 3б not «Тийм» → «8а-Тоглогч3»; teachers → «Багш-Тоглогч1»', () => {
  const teams = [
    { id: 10, name: '8а', players: [{ id: 1, slot: 3, consent_3a: true, consent_3b: false }, { id: 2, slot: 4, consent_3a: true, consent_3b: true }, { id: 3, slot: 5, consent_3a: null, consent_3b: true, alias: 'Бар' }] },
    { id: 4, name: 'Багш нарын баг', is_teachers: true, players: [{ id: 5, slot: 1 }] },
  ];
  assert.deepEqual(autoAliasPlan(teams), [
    { player_id: 1, team_id: 10, slot: 3, alias: '8а-Тоглогч3' },
    { player_id: 5, team_id: 4, slot: 1, alias: 'Багш-Тоглогч1' },
  ]);
  assert.equal(aliasFor({ name: '12а' }, 6), '12а-Тоглогч6');
  assert.equal(needsAlias({ consent_3a: true, consent_3b: true }), false);
});

test('roster checks mirror the server rules', () => {
  assert.deepEqual(playerErrors({ first_name: 'Бат-Эрдэнэ', surname_initial: 'Б.', steam_nickname: 'ab', steam_id64: '' }), []);
  assert.deepEqual(playerErrors({ first_name: '-Бат', surname_initial: 'Бб', steam_nickname: 'a', steam_id64: '7656119' }).map((e) => `${e.field}:${e.code}`),
    ['first_name:invalid', 'surname_initial:invalid', 'steam_nickname:too_short', 'steam_id64:invalid']);
  const r = rosterCheck([
    { slot: 1, first_name: 'А', surname_initial: 'Б', steam_nickname: 'Nick', is_captain: true },
    { slot: 2, first_name: 'В', surname_initial: 'Г', steam_nickname: 'nick', is_captain: true },
  ]);
  assert.ok(r.errors.some((e) => e.field === 'steam_nickname' && e.code === 'duplicate'));
  assert.ok(r.errors.some((e) => e.field === 'is_captain' && e.code === 'multiple'));
  assert.match(validationText([{ slot: null, field: 'players', code: 'count' }, { slot: 2, field: 'steam_nickname', code: 'taken' }]), /5–6 тоглогч хэрэгтэй; 2-р тоглогч — Steam нэр: Өөр багт бүртгэлтэй/);
});

test('scores: forfeit = LOSING side → 13:0 for the other; OT flag only in knockout', () => {
  assert.deepEqual(forfeitScore('a'), { a: 0, b: 13 });
  assert.deepEqual(forfeitScore('b'), { a: 13, b: 0 });
  assert.ok(validScore('group', 13, 0, 'b') && validScore('qf', 0, 13, 'a'));
  assert.ok(isOvertime('sf', 16, 14) && !isOvertime('group', 13, 11) && !isOvertime('final', 13, 11));
});

test('links, PIN message and local time conversion', () => {
  assert.equal(classLink('AbC_d-12'), 'https://shgge.github.io/cs2-2026/#/k/AbC_d-12');
  assert.equal(refLink('x'), 'https://shgge.github.io/cs2-2026/#/ref/x');
  assert.equal(pinMessage({ name: '8а', pin: '4821' }), '8а · Багшийн PIN: 4821 · Сурагчдад бүү өгнө үү.');
  assert.match(pinMessage({ name: 'Багш нарын баг', pin: '4821', is_teachers: true }), /Ахлагчийн PIN/);
  assert.equal(localInputToIso('2026-10-24T12:00'), '2026-10-24T12:00:00+08:00');
  assert.equal(isoToLocalInput('2026-10-24T04:00:00Z'), '2026-10-24T12:00');
  assert.equal(shortDateTime('2026-10-23T17:00:00+08:00'), '10.23 (Ба) 17:00');
});

// ---- integration alignment with the SQL admin API (supabase/migrations/08_admin_api.sql) ----
import { readFileSync, readdirSync } from 'node:fs';
import { streamName, matchzyWithAliases, consentRowsWithAliases } from '../docs/js/admin/util.js';
import { vault } from '../docs/js/admin/vault.js';

const root = new URL('../', import.meta.url);
const sql08 = readFileSync(new URL('supabase/migrations/08_admin_api.sql', root), 'utf8');
// The dispatcher as last (re)defined by the migrations (08, then 13_map_veto, …).
const migDir = new URL('supabase/migrations/', root);
const dispatcherSql = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => readFileSync(new URL(f, migDir), 'utf8'))
  .filter((s) => s.includes('function cs2_api.admin(')).pop();

test('every admin action the UI calls exists in the cs2_admin dispatcher', () => {
  const served = new Set([...dispatcherSql.matchAll(/^\s*when '([a-z_]+)'\s+then return/gm)].map((m) => m[1]));
  assert.ok(served.has('overview') && served.has('purge') && served.size >= 25, `dispatcher parsed: ${served.size}`);
  const dir = new URL('docs/js/admin/', root);
  const files = [...readdirSync(dir).map((f) => new URL(f, dir)), new URL('docs/js/pages/admin.js', root)];
  const used = new Set();
  for (const f of files) {
    for (const m of readFileSync(f, 'utf8').matchAll(/\b(?:call|act|admin)\((?:[\w.]+,\s*)?'([a-z_]+)'/g)) used.add(m[1]);
  }
  assert.ok(used.size >= 20, `UI actions parsed: ${used.size}`);
  for (const a of used) assert.ok(served.has(a), `UI calls unknown admin action '${a}'`);
});

test('game-feed names: Steam name only with 3а AND 3б «Тийм» (MatchZy + consent CSV)', () => {
  const t8 = { code: '8a', name: '8а', players: [
    { slot: 1, steam_id64: '76561190000000001', steam_nickname: '8а | Бат', consent_3a: true, consent_3b: true, alias: null },
    { slot: 2, steam_id64: '76561190000000002', steam_nickname: '8а | Дорж', consent_3a: false, consent_3b: true, alias: null },
    { slot: 3, steam_id64: '76561190000000003', steam_nickname: '8а | Сараа', consent_3a: true, consent_3b: null, alias: 'Шонхор' },
  ] };
  const tT = { code: 'teachers', name: 'Багш нарын баг', is_teachers: true, players: [] };
  assert.equal(streamName(t8.players[0], t8), '8а | Бат');
  assert.equal(streamName(t8.players[1], t8), '8а-Тоглогч2');
  assert.equal(streamName(t8.players[2], t8), 'Шонхор');
  assert.equal(streamName({ slot: 4, consent_3a: true, consent_3b: false }, tT), 'Багш-Тоглогч4');
  // server shape: display = steam name when 3б true → slot 2 must be replaced, unknown SteamIDs kept as given
  const mz = { '8a': { name: '8а', players: { '76561190000000001': '8а | Бат', '76561190000000002': '8а | Дорж', '76561190000000009': 'x' } } };
  assert.deepEqual(matchzyWithAliases(mz, [t8]), { '8a': { name: '8а', players: {
    '76561190000000001': '8а | Бат', '76561190000000002': '8а-Тоглогч2', '76561190000000009': 'x' } } });
  // consent CSV columns exactly as in SQL 08 (adm_export kind 'consent')
  const block = sql08.slice(sql08.indexOf("v_kind = 'consent'"), sql08.indexOf("v_kind = 'results'"));
  const columns = [...block.slice(block.indexOf('jsonb_build_array('), block.indexOf("'rows'")).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.equal(columns.length, 11, columns.join('|'));
  const row = ['8а', 2, 'Дорж', 'Д', '8а | Дорж', 'Тийм', 'Үгүй', 'Тийм', 'Тийм', '', '8а | Дорж'];
  const ok = ['8а', 1, 'Бат', 'Б', '8а | Бат', 'Тийм', 'Тийм', 'Тийм', 'Тийм', '', '8а | Бат'];
  const [r1, r2] = consentRowsWithAliases(columns, [row, ok], [t8]);
  assert.equal(r1[10], '8а-Тоглогч2');
  assert.equal(r2[10], '8а | Бат');
  assert.equal(row[10], '8а | Дорж'); // input not mutated
});

test('print: hidden test team only when no real class codes are held', () => {
  vault.clear();
  vault.putClass({ id: 99, code: 'test', name: 'ТЕСТ', is_hidden: true }, { token: 'tok99', pin: '5821' });
  assert.deepEqual(vault.printable('token').map((i) => i.team_id), [99]);
  vault.putClass({ id: 10, code: '8a', name: '8а' }, { token: 'tok10' });
  assert.deepEqual(vault.printable('token').map((i) => i.team_id), [10]);
  assert.deepEqual(vault.printable('pin').map((i) => i.team_id), [99]);
  vault.clear();
  assert.equal(validationText([{ slot: null, field: 'label', code: 'taken' }]), 'Нэр: Ийм нэр бүртгэлтэй');
  assert.equal(validationText([{ slot: null, field: 'grp', code: 'invalid' }]), 'Хэсэг: Хэлбэр буруу');
});
