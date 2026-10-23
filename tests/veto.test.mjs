// Tests for the map veto helpers in docs/js/logic.js and the pool in docs/js/event.js — run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAPS } from '../docs/js/event.js';
import { mapPool, mapInfo, vetoState } from '../docs/js/logic.js';

const KEYS = ['ancient', 'anubis', 'cache', 'dust2', 'inferno', 'mirage', 'nuke'];

test('MAPS: the 7 Active Duty maps with server ids; same pool as migration 13', () => {
  assert.deepEqual(MAPS.map((x) => x.key), KEYS);
  for (const x of MAPS) assert.match(x.id, /^de_[a-z0-9]+$/);
  assert.equal(mapInfo('dust2').name, 'Dust II');
  assert.equal(mapInfo('cache').id, 'de_cache');
  const sql = readFileSync(new URL('../supabase/migrations/13_map_veto.sql', import.meta.url), 'utf8');
  assert.ok(sql.includes(`array[${KEYS.map((k) => `'${k}'`).join(', ')}]`), 'migration default pool = MAPS');
});

test('migration 13: once the coin toss is set, a referee (station or chief) gets first_set; only admin re-tosses', () => {
  const sql = readFileSync(new URL('../supabase/migrations/13_map_veto.sql', import.meta.url), 'utf8');
  const first = sql.slice(sql.indexOf("when 'first' then"), sql.indexOf("when 'ban' then"));
  assert.match(first, /if m\.veto_first is not null and p_role is distinct from 'admin' then\s+return cs2\.err\('forbidden', jsonb_build_object\('reason', 'first_set'/);
  assert.doesNotMatch(first, /chief_only/);
  // ban: the side the client shows (p_side) must be the side the server books, else 'stale' before any write
  const ban = sql.slice(sql.indexOf("when 'ban' then"), sql.indexOf("when 'undo' then"));
  assert.match(ban, /in \('a', 'b'\) and lower\(btrim\(p_side\)\) <> v_side then\s+return cs2\.err\('stale'/);
  assert.ok(ban.indexOf("cs2.err('stale'") < ban.indexOf('update cs2.matches'));
});

test('rules page and referee slip: «ээлжлэн тус бүр 3» as in regulation 02 §7.9', () => {
  const read = (p) => readFileSync(new URL(`../docs/${p}`, import.meta.url), 'utf8');
  assert.ok(read('content/rules.html').includes('ээлжлэн тус бүр 3 газрын зураг хасаж, үлдсэнд нь тоглоно'));
  assert.ok(read('js/print.js').includes('ээлжлэн тус бүр 3 газрын зураг'));
});

test('mapPool: state settings win when valid, else MAPS', () => {
  assert.deepEqual(mapPool(null), KEYS);
  assert.deepEqual(mapPool({ settings: { map_pool: ['nuke', 'mirage', 'inferno'] } }), ['nuke', 'mirage', 'inferno']);
  assert.deepEqual(mapPool({ settings: { map_pool: ['nuke', 'overpass'] } }), KEYS);
  assert.deepEqual(mapPool({ settings: { map_pool: 'nuke' } }), KEYS);
});

test('vetoState: group match — side a bans first, A-B-A-B-A-B, the last map is played', () => {
  const m = { stage: 'group', veto: [] };
  let v = vetoState(m, KEYS);
  assert.equal(v.first, 'a');
  assert.deepEqual(v.next, { side: 'a', step: 0 });
  assert.equal(v.total, 6);
  assert.equal(v.done, false);
  const bans = ['nuke', 'cache', 'ancient', 'anubis', 'dust2', 'inferno'];
  m.veto = bans.map((map, i) => ({ side: i % 2 ? 'b' : 'a', map }));
  v = vetoState(m, KEYS);
  assert.equal(v.done, true);
  assert.equal(v.map, 'mirage');
  assert.equal(v.next, null);
  assert.deepEqual(v.remaining, ['mirage']);
  m.veto = m.veto.slice(0, 3);
  v = vetoState(m, KEYS);
  assert.deepEqual(v.next, { side: 'b', step: 3 });
  assert.deepEqual(v.banned, ['nuke', 'cache', 'ancient']);
});

test('vetoState: knockout needs the coin toss; first b → b bans first', () => {
  let v = vetoState({ stage: 'qf' }, KEYS);
  assert.equal(v.first, null);
  assert.equal(v.needsFirst, true);
  assert.equal(v.next, null);
  v = vetoState({ stage: 'final', veto_first: 'b', veto_coin: true, veto: [{ side: 'b', map: 'nuke' }] }, KEYS);
  assert.equal(v.coin, true);
  assert.deepEqual(v.next, { side: 'a', step: 1 });
});

test('vetoState: ignores junk, duplicates and unknown maps; never throws', () => {
  const v = vetoState({ stage: 'group', veto: [null, { side: 'a', map: 'nuke' }, { side: 'b', map: 'nuke' },
    { side: 'x', map: 'cache' }, { side: 'b', map: 'overpass' }, 'z'] }, KEYS);
  assert.deepEqual(v.steps, [{ side: 'a', map: 'nuke' }]);
  assert.doesNotThrow(() => vetoState(null));
  assert.doesNotThrow(() => vetoState(undefined, null));
  assert.equal(vetoState(null).first, null);
});
