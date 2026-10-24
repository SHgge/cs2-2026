// Migration 14 (Bo3 for the final 19 and the 3rd-place match 20): SQL text checks — the live DB was verified separately
// with a rollback-only batch (veto picks, games, hold, forfeit, admin, Bo1 regression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/14_bo3.sql', import.meta.url), 'utf8');
const fn = (name) => {
  const i = sql.indexOf(`create or replace function ${name}(`);
  assert.ok(i >= 0, `${name} defined in 14`);
  return sql.slice(i, sql.indexOf('$$;', sql.indexOf('as $$', i)) + 3);
};

test('14: columns and Bo3 matches', () => {
  assert.match(sql, /add column if not exists best_of smallint not null default 1 check \(best_of in \(1, 3\)\)/);
  assert.match(sql, /add column if not exists maps text\[\]/);
  assert.match(sql, /add column if not exists games jsonb not null default '\[\]'::jsonb/);
  assert.match(sql, /update cs2\.matches set best_of = 3 where no in \(19, 20\)/);
});

test('14: no GRANT/REVOKE/DROP/DELETE (applied through MCP)', () => {
  const code = sql.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(code, /\b(grant|revoke|drop|delete)\b/i);
});

test('14: veto picks follow the step sequence', () => {
  const v = fn('cs2.veto_apply');
  assert.match(fn('cs2.veto_act'), /p_bo = 3 and p_step in \(2, 3\) then 'pick' else 'ban'/);
  assert.match(v, /when 'ban', 'pick' then/);
  assert.match(v, /p_action <> v_act/);
  assert.match(v, /'games_started'/);
  assert.match(v, /maps = case when v_bo = 3 then cs2\.veto_maps\(v_veto, v_left\) end/);
  assert.match(v, /map = case when v_bo = 1 and cardinality\(v_left\) = 1 then v_left\[1\] end/);
});

test('14: match json exposes best_of, maps and held games', () => {
  const j = fn('cs2.match_json');
  assert.equal((j.match(/'best_of', m\.best_of, 'maps', to_jsonb\(m\.maps\)/g) || []).length, 2);
  assert.match(j, /'games', p\.games/);
  assert.match(j, /'games', m\.games/);
  assert.match(j, /interval '120 seconds'/);
  assert.match(fn('cs2.public_version'), /jsonb_array_elements\(m\.games\)/);
});

test('14: series writer, redirects and the new referee RPC', () => {
  const s = fn('cs2.series_set');
  assert.match(s, /'invalid_score', jsonb_build_object\('game'/);
  assert.match(s, /'reason', 'undecided'/);
  assert.match(s, /v_status := 'live';/);
  assert.match(fn('cs2.match_set'), /if m\.best_of = 3 then[\s\S]*cs2\.series_set\(p_no, p_status, null, p_forfeit/);
  assert.match(fn('cs2.adm_match_result'), /x\.best_of = 3[\s\S]*cs2\.series_set/);
  assert.match(fn('cs2.adm_match_update'), /cs2\.series_ok\(m\)/);
  assert.match(fn('cs2_api.ref_games'), /security definer/);
  assert.match(fn('public.cs2_ref_games'), /security invoker[\s\S]*cs2_api\.ref_games\(p_token, p_no, p_games\)/);
});

test('14: day-2 Bo3 slot and links until 20:00', () => {
  assert.match(sql, /start_at = '2026-10-25 14:30:00\+08', end_at = '2026-10-25 17:15:00\+08'/);
  assert.match(sql, /tokens_valid_until = '2026-10-25 20:00:00\+08'/);
  assert.match(sql, /alter column valid_until set default '2026-10-25 20:00:00\+08'/);
  assert.match(sql, /notify pgrst, 'reload schema'/);
});
