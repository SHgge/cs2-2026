-- 01_draw.sql — CONTRACT §3 draw test vector + draw state machine
-- (commit -> compute -> publish -> void -> manual). Everything is rolled back.
-- Run the whole file (execute_sql / psql). Success = last line 'PASS 01_draw'; any ASSERT aborts with its message.
begin;

do $$
declare
  c_secret constant text := '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
  c_inputs constant jsonb := '{"12a":1234,"11a":5,"11b":987,"teachers":42,"10a":0,"10b":9999,"10v":313,"9a":777,"9b":2024,"8a":8,"8b":55,"8v":1001}';
  c_groups constant jsonb := '{"A":["teachers","9a","9b"],"B":["12a","10b","8v"],"V":["11b","10a","8a"],"G":["11a","10v","8b"]}';
  c_seed   constant text := '362b441a74ad4f47eb6726b0238f078c114ca567640a5b96ea517dfa3f7d5798';
  r  jsonb;
  p  jsonb;
  v0 bigint;
begin
  assert not exists (select 1 from cs2.draws where status <> 'void'), 'test expects no active draw';
  select version into v0 from cs2.settings where id = 1;

  -- 1. pure computation = CONTRACT test vector
  r := cs2.draw_compute_groups(c_secret, c_inputs);
  assert r ->> 'inputs' = '12a=1234,11a=5,11b=987,teachers=42,10a=0,10b=9999,10v=313,9a=777,9b=2024,8a=8,8b=55,8v=1001', 'inputs string';
  assert r ->> 'seed' = c_seed, 'seed';
  assert r -> 'groups' = c_groups, 'groups';
  assert r -> 'keys' ->> 'teachers' = '88612555dfcdcd17a40cf67616418d121378d1ae08db95e987c675e95d14725a', 'key teachers';
  assert r -> 'keys' ->> '8b' = 'fac987f04bce10c4ee187bce4ac54aa25843c7f02b829b81b3fb5c9073a1fa02', 'key 8b';
  assert cs2.draw_compute_groups(upper(c_secret), c_inputs) ->> 'seed' = c_seed, 'secret is lower-cased';

  -- 2. state machine
  r := cs2.adm_draw_compute('admin:test', jsonb_build_object('secret', c_secret, 'inputs', c_inputs));
  assert r ->> 'error' = 'draw_state', 'compute before commit';
  r := cs2.adm_draw_publish('admin:test', '{}');
  assert r ->> 'error' = 'draw_state', 'publish before commit';
  r := cs2.adm_draw_commit('admin:test', '{"commit":"abc"}');
  assert r ->> 'error' = 'validation', 'bad commit format';
  r := cs2.adm_draw_commit('admin:test', jsonb_build_object('commit', upper(cs2.sha256_hex(c_secret))));
  assert (r ->> 'ok')::boolean and r -> 'draw' ->> 'status' = 'committed', 'commit ok';
  r := cs2.adm_draw_commit('admin:test', jsonb_build_object('commit', cs2.sha256_hex(c_secret)));
  assert r ->> 'error' = 'draw_state', 'second commit refused';

  p := cs2_api.public_state(null);
  assert p -> 'draw' ->> 'status' = 'committed' and p -> 'draw' ->> 'commit' = cs2.sha256_hex(c_secret), 'public: committed';
  assert p -> 'draw' -> 'secret' = 'null'::jsonb and p -> 'draw' -> 'groups' = 'null'::jsonb, 'public: secret hidden before compute';

  r := cs2.adm_draw_compute('admin:test', jsonb_build_object('secret', repeat('ab', 32), 'inputs', c_inputs));
  assert r ->> 'error' = 'bad_commit', 'wrong secret -> bad_commit';
  r := cs2.adm_draw_compute('admin:test', jsonb_build_object('secret', c_secret, 'inputs', c_inputs - '8v'));
  assert r ->> 'error' = 'validation' and r -> 'errors' @> '[{"field":"inputs.8v","code":"required"}]', 'missing input';
  r := cs2.adm_draw_compute('admin:test', jsonb_build_object('secret', c_secret, 'inputs', c_inputs || '{"8v":10000}'));
  assert r ->> 'error' = 'validation' and r -> 'errors' @> '[{"field":"inputs.8v","code":"invalid"}]', 'input > 9999';
  r := cs2.adm_draw_compute('admin:test', jsonb_build_object('secret', c_secret, 'inputs', c_inputs || '{"10a":"0"}'));
  assert (r ->> 'ok')::boolean, 'compute ok: ' || r::text;
  assert r -> 'draw' ->> 'seed' = c_seed and r -> 'draw' -> 'groups' = c_groups, 'computed = vector';

  p := cs2_api.public_state(null);
  assert p -> 'draw' ->> 'status' = 'computed', 'public: computed';
  assert p -> 'draw' ->> 'secret' = c_secret and p -> 'draw' -> 'groups' = c_groups and p -> 'draw' -> 'inputs' = c_inputs,
         'public: secret, inputs and groups revealed for verification';
  assert not exists (select 1 from cs2.teams where grp is not null), 'no seats before publish';

  r := cs2.adm_draw_publish('admin:test', '{}');
  assert (r ->> 'ok')::boolean and r -> 'draw' ->> 'status' = 'published', 'publish ok';
  assert (select grp || seat from cs2.teams where code = 'teachers') = 'A1', 'teachers = A1';
  assert (select grp || seat from cs2.teams where code = '9a') = 'A2', '9a = A2';
  assert (select grp || seat from cs2.teams where code = '8b') = 'G3', '8b = G3';
  assert (select count(*) from cs2.teams where grp is not null) = 12, '12 seats';
  assert (select team_a = 4 and team_b = 8 from cs2.matches where no = 1), 'match 1 = A1 teachers - A2 9a';
  assert (select team_a = 1 and team_b = 6 from cs2.matches where no = 2), 'match 2 = B1 12a - B2 10b';
  assert (select team_a = 7 and team_b = 11 from cs2.matches where no = 12), 'match 12 = G2 10v - G3 8b';
  assert (select count(*) from cs2.matches where stage = 'group' and team_a is not null and team_b is not null) = 12,
         'all group matches resolved';
  r := cs2.adm_draw_publish('admin:test', '{}');
  assert r ->> 'error' = 'draw_state', 'publish only once';

  -- 3. void is blocked once a group match has started
  perform cs2.match_set(1, 'reported', 13, 5, null, null, null, 'admin:test', 'admin');
  r := cs2.adm_draw_void('admin:test', '{"reason":"Туршилт"}');
  assert r ->> 'error' = 'draw_state', 'void blocked after a reported group match';
  perform cs2.match_set(1, 'live', null, null, null, null, null, 'admin:test', 'admin');
  update cs2.matches set status = 'scheduled' where no = 1;
  r := cs2.adm_draw_void('admin:test', '{}');
  assert r ->> 'error' = 'validation', 'void needs a reason';
  r := cs2.adm_draw_void('admin:test', '{"reason":"Туршилт"}');
  assert (r ->> 'ok')::boolean and r -> 'draw' ->> 'status' = 'none', 'void ok';
  assert r -> 'draw' -> 'history' @> '[{"status":"void","reason":"Туршилт"}]', 'history records the void';
  assert not exists (select 1 from cs2.teams where grp is not null), 'seats cleared';
  assert not exists (select 1 from cs2.matches where stage = 'group' and team_a is not null), 'group teams cleared';

  -- 4. manual (physical lot) fallback
  r := cs2.adm_draw_manual('admin:test', jsonb_build_object('reason', 'Гар сугалаа', 'groups',
         '{"A":["9a","teachers","9b"],"B":["12a","10b","8v"],"V":["11b","10a","8a"],"G":["11a","10v","8b"]}'::jsonb));
  assert r ->> 'error' = 'validation' and r -> 'errors' @> '[{"field":"groups.A","code":"wrong_pot"}]', 'manual: wrong pot';
  r := cs2.adm_draw_manual('admin:test', jsonb_build_object('reason', 'Гар сугалаа', 'groups',
         '{"A":["teachers","9a","9b"],"B":["teachers","10b","8v"],"V":["11b","10a","8a"],"G":["11a","10v","8b"]}'::jsonb));
  assert r ->> 'error' = 'validation' and r -> 'errors' @> '[{"field":"groups.B","code":"duplicate"}]', 'manual: duplicate';
  r := cs2.adm_draw_manual('admin:test', jsonb_build_object('groups', c_groups));
  assert r ->> 'error' = 'validation', 'manual needs a reason';
  perform cs2.adm_draw_commit('admin:test', jsonb_build_object('commit', cs2.sha256_hex(c_secret)));
  r := cs2.adm_draw_manual('admin:test', jsonb_build_object('reason', 'Гар сугалаа', 'groups', c_groups));
  assert (r ->> 'ok')::boolean and r -> 'draw' ->> 'status' = 'published' and r -> 'draw' ->> 'method' = 'manual',
         'manual replaces a pending commit and is published';
  assert (select count(*) from cs2.draws where status <> 'void') = 1, 'one active draw';
  assert (select count(*) from cs2.teams where grp is not null) = 12, 'manual seats written';
  r := cs2.adm_draw_manual('admin:test', jsonb_build_object('reason', 'x', 'groups', c_groups));
  assert r ->> 'error' = 'draw_state', 'manual refused after publish';

  -- 5. every mutation bumped the version and was audited
  assert (select version from cs2.settings where id = 1) >= v0 + 8, 'version bumped';
  assert (select count(*) from cs2.audit_log where actor = 'admin:test' and action like 'draw%') >= 7, 'audited';
end $$;

rollback;
select 'PASS 01_draw' as result;
