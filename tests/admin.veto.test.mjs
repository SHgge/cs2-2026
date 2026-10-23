// Admin map veto helpers (docs/js/admin/veto.js) — pure functions, synthetic data only. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { vetoReady, vetoEnabled, vetoSummary, vetoErrorText, maplistLine, serverCommand, VETO_OFF_TEXT, KNIFE_TEXT } from '../docs/js/admin/veto.js';
import { vetoState, mapPool } from '../docs/js/logic.js';

const POOL = mapPool(null);
const bans = (list, first = 'a') => list.map((map, i) => ({ side: i % 2 === 0 ? first : (first === 'a' ? 'b' : 'a'), map }));

test('vetoReady: needs the migration-13 fields on the matches', () => {
  assert.equal(vetoReady(null), false);
  assert.equal(vetoReady({ matches: [] }), false);
  assert.equal(vetoReady({ matches: [{ no: 1, stage: 'group' }] }), false, 'old state without veto fields');
  assert.equal(vetoReady({ matches: [{ no: 1, veto: [], veto_first: null, veto_coin: false, map: null }] }), true);
  assert.equal(vetoEnabled({ matches: [{ no: 1, veto: [] }] }), true);
});

test('vetoSummary: not started / in progress / decided', () => {
  const g = vetoSummary(vetoState({ stage: 'group', veto: [] }, POOL), '12а', '10а');
  assert.deepEqual(g, { text: 'Эхлээгүй', detail: '12а эхэлж хасна', kind: '' });
  const ko = vetoSummary(vetoState({ stage: 'qf', veto: [] }, POOL), '12а', '10а');
  assert.equal(ko.text, 'Эхлээгүй');
  assert.equal(ko.detail, 'зоос шидээгүй');
  const coin = vetoSummary(vetoState({ stage: 'sf', veto_first: 'b', veto_coin: true, veto: [] }, POOL), '12а', '10а');
  assert.equal(coin.detail, '10а эхэлж хасна (зоосоор)');
  const mid = vetoSummary(vetoState({ stage: 'group', veto: bans(['nuke', 'cache', 'ancient']) }, POOL), '12а', '10а');
  assert.deepEqual(mid, { text: 'Хасалт 3/6 — 10а хасна', detail: '', kind: 'warn' });
  const koMid = vetoSummary(vetoState({ stage: 'final', veto_first: 'b', veto: bans(['nuke'], 'b') }, POOL), '12а', '10а');
  assert.equal(koMid.text, 'Хасалт 1/6 — 12а хасна');
  const done = vetoSummary(vetoState({ stage: 'group', veto: bans(['nuke', 'cache', 'ancient', 'anubis', 'inferno', 'mirage']) }, POOL), 'x', 'y');
  assert.deepEqual(done, { text: 'Dust II', detail: '', kind: 'ok' });
  assert.equal(vetoSummary(null, 'x', 'y').text, 'Эхлээгүй');
  // final match without a finished veto; teams not known yet
  const lockedNone = vetoSummary(vetoState({ stage: 'group', status: 'final', veto: [] }, POOL), '12а', '10а', { locked: true });
  assert.deepEqual(lockedNone, { text: '—', detail: 'хасалт бүртгээгүй', kind: '' });
  const lockedPart = vetoSummary(vetoState({ stage: 'group', veto: bans(['nuke']) }, POOL), '12а', '10а', { locked: true });
  assert.equal(lockedPart.detail, 'хасалт 1/6, дуусаагүй');
  const lockedDone = vetoSummary(vetoState({ stage: 'group', veto: bans(['nuke', 'cache', 'ancient', 'anubis', 'dust2', 'mirage']) }, POOL), 'x', 'y', { locked: true });
  assert.equal(lockedDone.text, 'Inferno');
  assert.deepEqual(vetoSummary(vetoState({ stage: 'qf', veto: [] }, POOL), 'А№1', 'Б№2', { known: false }), { text: 'Эхлээгүй', detail: '', kind: '' });
});

test('maplistLine: MatchZy match JSON line with the server map id (valid JSON member)', () => {
  assert.equal(maplistLine('inferno'), '"maplist": ["de_inferno"]');
  assert.equal(maplistLine('dust2'), '"maplist": ["de_dust2"]');
  assert.equal(maplistLine(null), '');
  assert.equal(maplistLine(''), '');
  for (const key of POOL) assert.deepEqual(JSON.parse(`{${maplistLine(key)}}`), { maplist: [`de_${key}`] });
});

test('serverCommand: changelevel with the server map id', () => {
  assert.equal(serverCommand('mirage'), 'changelevel de_mirage');
  assert.equal(serverCommand('dust2'), 'changelevel de_dust2');
  assert.equal(serverCommand(null), '');
  assert.match(KNIFE_TEXT, /хутганы раунд/);
});

test('vetoErrorText: forbidden reasons, validation, old API, stale', () => {
  assert.equal(vetoErrorText({ ok: false, error: 'not_found', action: 'match_veto' }), `${VETO_OFF_TEXT}.`);
  assert.match(VETO_OFF_TEXT, /migration 13/);
  assert.match(vetoErrorText({ error: 'forbidden', reason: 'final' }), /баталгаажсан/);
  assert.match(vetoErrorText({ error: 'forbidden', reason: 'group_fixed' }), /эхэнд бичигдсэн/);
  assert.match(vetoErrorText({ error: 'forbidden', reason: 'veto_started' }), /Шинээр эхлүүлэх/);
  assert.match(vetoErrorText({ error: 'forbidden', reason: 'first_missing' }), /зоос/);
  assert.match(vetoErrorText({ error: 'forbidden', reason: 'veto_done' }), /дууссан/);
  assert.match(vetoErrorText({ error: 'forbidden', reason: 'veto_empty' }), /Буцаах/);
  assert.match(vetoErrorText({ error: 'validation', errors: [{ field: 'map', code: 'taken' }] }), /аль хэдийн хасагдсан/);
  assert.match(vetoErrorText({ error: 'validation', errors: [{ field: 'map', code: 'invalid' }] }), /буруу/);
  assert.match(vetoErrorText({ error: 'validation', errors: [{ field: 'side', code: 'invalid' }] }), /Эхлэх баг/);
  assert.match(vetoErrorText({ error: 'stale', step: 2 }), /Өөр төхөөрөмж/);
  assert.match(vetoErrorText({ error: 'not_found' }), /Олдсонгүй/);
  assert.match(vetoErrorText({ error: 'network' }), /Сүлжээ/);
});
