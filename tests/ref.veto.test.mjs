// Tests for the map veto helpers of the referee page (docs/js/pages/ref.js) — run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = globalThis.document || { addEventListener() {}, hidden: false };   // store.js touches document at import
const { _test: R, VETO_OFF_TEXT } = await import('../docs/js/pages/ref.js');
const { vetoState, mapPool } = await import('../docs/js/logic.js');

const KEYS = mapPool(null);

test('vetoAccess: station referee — own station, scheduled/live only; chief — everything but final', () => {
  const st = { station: 'A', chief: false };
  const chief = { station: null, chief: true };
  assert.equal(R.vetoAccess({ station: 'A', status: 'scheduled' }, st).can, true);
  assert.equal(R.vetoAccess({ station: 'A', status: 'live' }, st).can, true);
  assert.deepEqual(R.vetoAccess({ station: 'A', status: 'reported' }, st), { can: false, chief: false, reason: 'already_reported' });
  assert.equal(R.vetoAccess({ station: 'B', status: 'live' }, st).reason, 'other_station');
  assert.equal(R.vetoAccess({ station: 'A', status: 'final' }, st).reason, 'final');
  assert.equal(R.vetoAccess({ station: 'B', status: 'reported' }, chief).can, true);
  assert.equal(R.vetoAccess({ station: 'B', status: 'reported' }, chief).chief, true);
  assert.equal(R.vetoAccess({ station: 'B', status: 'final' }, chief).can, false);
  assert.equal(R.vetoAccess(null, chief).can, false);
});

test('vetoFields / mergeVeto: only veto fields, old DB (absent fields) → no change', () => {
  const full = { no: 3, status: 'reported', score_a: 13, veto_first: 'a', veto_coin: false, veto: [{ side: 'a', map: 'nuke' }], map: null };
  assert.deepEqual(R.vetoFields(full), { veto_first: 'a', veto_coin: false, veto: [{ side: 'a', map: 'nuke' }], map: null });
  assert.deepEqual(R.vetoFields({ no: 3, status: 'live' }), {});
  assert.deepEqual(R.vetoFields(null), {});
  const list = [{ no: 1, status: 'live' }, { no: 3, status: 'live', score_a: null }];
  const out = R.mergeVeto(list, 3, R.vetoFields(full));
  assert.equal(out[1].status, 'live', 'status is not taken from the veto reply');
  assert.equal(out[1].score_a, null);
  assert.deepEqual(out[1].veto, [{ side: 'a', map: 'nuke' }]);
  assert.equal(out[0], list[0]);
  assert.notEqual(out, list);
  assert.deepEqual(R.mergeVeto(null, 3, {}), []);
});

test('vetoTiles: pool order, ban side + order, the last map is played', () => {
  const bans = ['nuke', 'cache', 'ancient', 'anubis', 'dust2', 'inferno'];
  const m = { stage: 'group', veto: bans.slice(0, 2).map((map, i) => ({ side: i % 2 ? 'b' : 'a', map })) };
  let tiles = R.vetoTiles(vetoState(m, KEYS), KEYS);
  assert.deepEqual(tiles.map((t) => t.key), KEYS);
  assert.deepEqual(tiles.find((t) => t.key === 'nuke').ban, { side: 'a', order: 1 });
  assert.deepEqual(tiles.find((t) => t.key === 'cache').ban, { side: 'b', order: 2 });
  assert.equal(tiles.find((t) => t.key === 'dust2').name, 'Dust II');
  assert.equal(tiles.some((t) => t.play), false);
  m.veto = bans.map((map, i) => ({ side: i % 2 ? 'b' : 'a', map }));
  tiles = R.vetoTiles(vetoState(m, KEYS), KEYS);
  assert.deepEqual(tiles.filter((t) => t.play).map((t) => t.key), ['mirage']);
  assert.equal(tiles.filter((t) => t.ban).length, 6);
  // missing veto fields (DB before migration 13) → all 7 free, never throws
  tiles = R.vetoTiles(vetoState({ stage: 'qf', status: 'scheduled' }, KEYS), KEYS);
  assert.equal(tiles.length, 7);
  assert.ok(tiles.every((t) => !t.ban && !t.play));
  assert.equal(R.vetoTiles(null, null).length, 0);
});

test('vetoCollapsed: in progress → full; done → compact unless this match + same status was opened', () => {
  const bans = ['nuke', 'cache', 'ancient', 'anubis', 'dust2', 'inferno'].map((map, i) => ({ side: i % 2 ? 'b' : 'a', map }));
  const live = { no: 1, stage: 'group', status: 'live', veto: bans };
  const done = vetoState(live, KEYS);
  assert.equal(R.vetoCollapsed(vetoState({ ...live, veto: bans.slice(0, 5) }, KEYS), live, null), false, 'in progress');
  assert.equal(R.vetoCollapsed(done, live, null), true, 'done, no view → compact');
  assert.equal(R.vetoCollapsed(done, live, { no: 1, status: 'live', open: true }), false, 'opened on demand');
  assert.equal(R.vetoCollapsed(done, live, { no: 1, status: 'live', open: false }), true, 'closed again');
  assert.equal(R.vetoCollapsed(done, live, { no: 1, status: 'scheduled', open: true }), true, 'opened before the start → the match started → compact');
  assert.equal(R.vetoCollapsed(done, live, { no: 2, status: 'live', open: true }), true, 'another match');
  assert.equal(R.vetoCollapsed(vetoState({ stage: 'qf' }, KEYS), { no: 13, status: 'live' }, null), false, 'no veto yet');
  assert.equal(R.vetoCollapsed(null, null, null), false);
});

test('vetoBanArgs: a ban carries the step and the side this device shows as «… хасна»', () => {
  const g = { stage: 'group', veto: [] };
  assert.deepEqual(R.vetoBanArgs(vetoState(g, KEYS), 'nuke'), { map: 'nuke', step: 0, side: 'a' }, 'group: the team listed first bans first');
  g.veto = [{ side: 'a', map: 'nuke' }];
  assert.deepEqual(R.vetoBanArgs(vetoState(g, KEYS), 'cache'), { map: 'cache', step: 1, side: 'b' });
  const ko = { stage: 'qf', veto_first: 'b', veto_coin: true, veto: [] };
  assert.deepEqual(R.vetoBanArgs(vetoState(ko, KEYS), 'nuke'), { map: 'nuke', step: 0, side: 'b' }, 'knockout: the coin winner bans first');
  ko.veto = [{ side: 'b', map: 'nuke' }, { side: 'a', map: 'cache' }];
  assert.deepEqual(R.vetoBanArgs(vetoState(ko, KEYS), 'ancient'), { map: 'ancient', step: 2, side: 'b' });
  // the coin was re-tossed on another device (b → a) but this page has not reloaded: it still sends 'b',
  // so the server answers 'stale' instead of booking the ban for the other team
  const seen = vetoState({ stage: 'qf', veto_first: 'b', veto: [] }, KEYS);
  const now = vetoState({ stage: 'qf', veto_first: 'a', veto: [] }, KEYS);
  assert.equal(R.vetoBanArgs(seen, 'nuke').step, now.steps.length, 'the step alone cannot see the change');
  assert.notEqual(R.vetoBanArgs(seen, 'nuke').side, now.next.side);
  // no turn (coin missing) → side null (no «хасах» button is shown then; the server ignores null)
  assert.equal(R.vetoBanArgs(vetoState({ stage: 'qf', veto: [] }, KEYS), 'nuke').side, null);
});

test('shortTeam, serverCmd', () => {
  assert.equal(R.shortTeam('Багш нарын баг'), 'Багш нар');
  assert.equal(R.shortTeam('12а'), '12а');
  assert.equal(R.shortTeam(null), '');
  assert.equal(R.serverCmd('mirage'), 'changelevel de_mirage');
  assert.equal(R.serverCmd('dust2'), 'changelevel de_dust2');
});

test('isMissingRpc / vetoErrorText', () => {
  assert.equal(R.isMissingRpc(new Error('http_404')), true);
  assert.equal(R.isMissingRpc(new Error('http_500')), false);
  assert.equal(R.isMissingRpc(new Error('network')), false);
  assert.equal(R.isMissingRpc(null), false);
  assert.match(VETO_OFF_TEXT, /идэвхжээгүй/);
  assert.match(R.vetoErrorText({ ok: false, error: 'stale', step: 2 }), /Өөр төхөөрөмжөөс/);
  assert.match(R.vetoErrorText({ ok: false, error: 'forbidden', reason: 'chief_only' }), /ерөнхий шүүгч/);
  assert.match(R.vetoErrorText({ ok: false, error: 'forbidden', reason: 'already_reported' }), /Оноо илгээсэн/);
  assert.match(R.vetoErrorText({ ok: false, error: 'forbidden', reason: 'first_missing' }), /зоос/);
  assert.match(R.vetoErrorText({ ok: false, error: 'forbidden', reason: 'first_set', veto_first: 'a' }), /аль хэдийн шидсэн.*шинээр эхлүүлнэ/);
  assert.equal(R.vetoErrorText({ ok: false, error: 'forbidden', reason: 'zzz' }), 'Энэ үйлдлийг хийх эрхгүй.');
  assert.match(R.vetoErrorText({ ok: false, error: 'validation', errors: [{ field: 'map', code: 'taken' }] }), /аль хэдийн хасагдсан/);
  assert.match(R.vetoErrorText({ ok: false, error: 'validation', errors: [{ field: 'side', code: 'invalid' }] }), /баг буруу/);
  assert.match(R.vetoErrorText({ ok: false, error: 'validation' }), /Мэдээлэл буруу/);
  assert.equal(R.vetoErrorText({ ok: false, error: 'server' }), 'Алдаа гарлаа. Дахин оролдоно уу.');
  for (const reason of ['final', 'already_reported', 'group_fixed', 'veto_started', 'first_set', 'chief_only', 'first_missing', 'veto_done', 'veto_empty', 'other_station']) {
    assert.notEqual(R.vetoErrorText({ ok: false, error: 'forbidden', reason }), 'Энэ үйлдлийг хийх эрхгүй.', reason);
  }
});
