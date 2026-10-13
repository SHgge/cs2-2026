-- 02_roster.sql — class API (CONTRACT §4): link tokens, roster validation, optimistic version,
-- consent ticks kept with the same person, injection/huge inputs. Uses the hidden test team 99.
-- Everything is rolled back. Success = last line 'PASS 02_roster'; any ASSERT aborts with its message.
begin;

do $$
declare
  c_tok constant text := 'roster-test-token-0000000001';
  r      jsonb;
  v      integer;
  e      jsonb;
  v_pid  bigint;
  c_good constant jsonb := '[
    {"slot":1,"first_name":"  Анар   Эрдэнэ ","surname_initial":"б.","steam_nickname":"ТЕСТ | Anar","steam_id64":"76561190000000011","is_captain":true,"age13":true},
    {"slot":2,"first_name":"Сарнай","surname_initial":"Ө","steam_nickname":"ТЕСТ | Sarnai","age13":"true"},
    {"slot":3,"first_name":"Тэмүүлэн","surname_initial":"Ү","steam_nickname":"ТЕСТ | Temuulen","age13":1},
    {"slot":4,"first_name":"John","surname_initial":"S","steam_nickname":"ТЕСТ | John","steam_id64":"","age13":true},
    {"slot":5,"first_name":"Мөнх-Очир","surname_initial":"Д","steam_nickname":"ТЕСТ | Munkh","age13":true},
    {"slot":6,"first_name":"Номин","surname_initial":"Г","steam_nickname":"ТЕСТ | Nomin","age13":false},
    {"slot":9,"first_name":"","surname_initial":"","steam_nickname":"","steam_id64":""}
  ]';
begin
  update cs2.settings set reg_closes_at = now() + interval '1 day', roster_freeze_at = now() + interval '2 days',
         tokens_valid_until = now() + interval '3 days', registration_open = true where id = 1;   -- date-independent window
  update cs2.team_access set token_sha256 = cs2.sha256_hex(c_tok), token_issued_at = now() where team_id = 99;

  -- 1. tokens
  assert cs2_api.class_get('nope') ->> 'error' = 'bad_token', 'short token';
  assert cs2_api.class_get(null) ->> 'error' = 'bad_token', 'null token';
  assert cs2_api.class_get('roster-test-token-0000000002') ->> 'error' = 'bad_token', 'unknown token';
  assert cs2_api.class_get(c_tok || ''';drop table cs2.players;--') ->> 'error' = 'bad_token', 'injection in token';
  assert cs2_api.class_save('roster-test-token-0000000002', '{}') ->> 'error' = 'bad_token', 'save: unknown token';
  r := cs2_api.class_get(c_tok);
  assert (r ->> 'ok')::boolean and r -> 'team' ->> 'code' = 'test' and r -> 'team' ->> 'name' = 'ТЕСТ', 'class_get ok: ' || r::text;
  assert r -> 'players' = '[]'::jsonb and not (r -> 'checks' ->> 'complete')::boolean, 'empty roster';
  assert r ? 'window' and r ? 'version' and r ? 'now' and r ? 'confirmed_at', 'class_get keys';
  v := (r ->> 'version')::integer;

  -- 2. payload and optimistic version
  assert cs2_api.class_save(c_tok, '[]') ->> 'error' = 'validation', 'payload must be an object';
  r := cs2_api.class_save(c_tok, '{"players":[]}');
  assert r ->> 'error' = 'validation' and r -> 'errors' @> '[{"field":"expected_version","code":"required"}]',
         'expected_version required: ' || r::text;
  r := cs2_api.class_save(c_tok, jsonb_build_object('expected_version', v + 5, 'players', '[]'::jsonb));
  assert r ->> 'error' = 'version_conflict' and (r ->> 'version')::integer = v
         and r -> 'state' -> 'team' ->> 'code' = 'test', 'version_conflict carries the current state: ' || r::text;
  assert cs2_api.class_save(c_tok, jsonb_build_object('expected_version', v, 'players', '{"a":1}'::jsonb)) ->> 'error'
         = 'validation', 'players must be an array';

  -- 3. field validation (all errors at once, by slot)
  r := cs2_api.class_save(c_tok, jsonb_build_object('expected_version', v, 'players', jsonb_build_array(
         jsonb_build_object('slot', 1, 'first_name', '', 'surname_initial', 'Б', 'steam_nickname', 'abc'),
         jsonb_build_object('slot', 2, 'first_name', 'Бат2', 'surname_initial', 'БХ', 'steam_nickname', 'a'),
         jsonb_build_object('slot', 3, 'first_name', repeat('Ж', 31), 'surname_initial', '1', 'steam_nickname', repeat('n', 33)),
         jsonb_build_object('slot', 4, 'first_name', 'Анар-Эрдэнэ', 'surname_initial', 'Ө.', 'steam_nickname', 'dup',
                            'steam_id64', '123'),
         jsonb_build_object('slot', 4, 'first_name', 'Тэмүүлэн', 'surname_initial', 'Ү', 'steam_nickname', 'x2'),
         jsonb_build_object('slot', 7, 'first_name', 'Saran', 'surname_initial', 'B', 'steam_nickname', 'x3'),
         jsonb_build_object('slot', 5, 'first_name', 'Saran', 'surname_initial', 'B', 'steam_nickname', 'DUP', 'is_captain', true),
         jsonb_build_object('slot', 6, 'first_name', 'Dorj', 'surname_initial', 'C', 'steam_nickname', 'x4', 'is_captain', true,
                            'steam_id64', '76561190000000001'),
         jsonb_build_object('slot', 'x', 'first_name', 'Dorj', 'surname_initial', 'C', 'steam_nickname', 'x5'),
         jsonb_build_object('slot', 3.5, 'first_name', 'Dorj', 'surname_initial', 'C', 'steam_nickname', 'x6'),
         '"not an object"'::jsonb)));
  assert r ->> 'error' = 'validation', 'validation expected: ' || r::text;
  e := r -> 'errors';
  assert e @> '[{"slot":1,"field":"first_name","code":"required"}]', 'slot 1 first_name required';
  assert e @> '[{"slot":2,"field":"first_name","code":"invalid"}]', 'slot 2 digits in name';
  assert e @> '[{"slot":2,"field":"surname_initial","code":"invalid"}]', 'slot 2 two-letter initial';
  assert e @> '[{"slot":2,"field":"steam_nickname","code":"too_short"}]', 'slot 2 nickname < 2';
  assert e @> '[{"slot":3,"field":"first_name","code":"too_long"}]', 'slot 3 name > 30';
  assert e @> '[{"slot":3,"field":"surname_initial","code":"invalid"}]', 'slot 3 initial not a letter';
  assert e @> '[{"slot":3,"field":"steam_nickname","code":"too_long"}]', 'slot 3 nickname > 32';
  assert e @> '[{"slot":4,"field":"steam_id64","code":"invalid"}]', 'slot 4 SteamID64 format';
  assert e @> '[{"slot":4,"field":"slot","code":"duplicate"}]', 'duplicate slot';
  assert e @> '[{"slot":null,"field":"slot","code":"invalid"}]', 'slot 7 / "x" / 3.5 invalid';
  assert (select count(*) from jsonb_array_elements(e) x where x = '{"slot":null,"field":"slot","code":"invalid"}') = 3,
         'three invalid slots';
  assert e @> '[{"slot":5,"field":"steam_nickname","code":"duplicate"}]', 'nickname duplicate (case-insensitive)';
  assert e @> '[{"slot":6,"field":"is_captain","code":"multiple"}]', 'two captains';
  assert e @> '[{"slot":null,"field":"players","code":"invalid"}]', 'non-object entry';
  assert not (e @> '[{"slot":4,"field":"first_name"}]') and not (e @> '[{"slot":4,"field":"surname_initial"}]'),
         'hyphenated Cyrillic name and «Ө.» are valid';
  assert (select version from cs2.team_access where team_id = 99) = v and not exists (select 1 from cs2.players where team_id = 99),
         'nothing written on validation errors';

  -- 4. Steam name / SteamID unique across teams; the error does not reveal the other team
  perform cs2.roster_write(1, '[{"slot":1,"first_name":"Бусад","surname_initial":"Б","steam_nickname":"12а | TakenNick","steam_id64":"76561190000000002","is_captain":true,"age13":true}]');
  r := cs2_api.class_save(c_tok, jsonb_build_object('expected_version', v, 'players', jsonb_build_array(
         jsonb_build_object('slot', 1, 'first_name', 'Бат', 'surname_initial', 'Б', 'steam_nickname', '12А | takennick'),
         jsonb_build_object('slot', 2, 'first_name', 'Дорж', 'surname_initial', 'Д', 'steam_nickname', 'own-nick',
                            'steam_id64', '76561190000000002'))));
  assert r ->> 'error' = 'validation' and r -> 'errors' @> '[{"slot":1,"field":"steam_nickname","code":"taken"},
         {"slot":2,"field":"steam_id64","code":"taken"}]', 'taken across teams: ' || r::text;
  assert position('12а' in (r - 'errors')::text) = 0 and position('12a' in r::text) = 0 and position('Бусад' in r::text) = 0,
         'other team not revealed';

  -- 5. valid save: normalised values, empty card skipped, version +1
  r := cs2_api.class_save(c_tok, jsonb_build_object('expected_version', v, 'players', c_good));
  assert (r ->> 'ok')::boolean, 'valid save: ' || r::text;
  assert (r ->> 'version')::integer = v + 1, 'version + 1';
  assert jsonb_array_length(r -> 'players') = 6, '6 players (empty card skipped)';
  assert r -> 'players' -> 0 ->> 'first_name' = 'Анар Эрдэнэ' and r -> 'players' -> 0 ->> 'surname_initial' = 'Б',
         'trimmed name, upper-case initial without dot';
  assert (r -> 'players' -> 0 ->> 'is_captain')::boolean and (r -> 'players' -> 1 ->> 'age13')::boolean
         and (r -> 'players' -> 2 ->> 'age13')::boolean, 'boolean-ish inputs';
  assert r -> 'players' -> 3 -> 'steam_id64' = 'null'::jsonb, 'empty SteamID64 = null';
  assert not (r -> 'checks' ->> 'complete')::boolean and r -> 'checks' -> 'errors' = '[{"slot":6,"field":"age13","code":"required"}]',
         'checks: substitute not 13+: ' || (r -> 'checks')::text;
  assert not (r -> 'players' -> 0 ? 'alias') and not (r -> 'players' -> 0 ? 'consent_3b') and not (r -> 'players' -> 0 ? 'id'),
         'class view has no alias / 3а-3в / ids';
  assert exists (select 1 from cs2.audit_log where actor = 'class:test' and action = 'class_save' and team_id = 99),
         'class save audited';

  -- 6. consent ticks and alias follow the same person when the class reorders the roster
  select id into v_pid from cs2.players where team_id = 99 and slot = 2;
  r := cs2.adm_consent_set('admin:test', jsonb_build_object('player_id', v_pid, 'consent_paper', true, 'alias', 'ТЕСТ-Тоглогч2'));
  assert (r ->> 'ok')::boolean, 'consent_set: ' || r::text;
  assert (select version from cs2.team_access where team_id = 99) = v + 1, 'consent ticks do not bump the roster version';
  r := cs2_api.class_save(c_tok, jsonb_build_object('expected_version', v + 1, 'players',
         jsonb_set(jsonb_set(c_good, '{1,slot}', '3'), '{2,slot}', '2')));
  assert (r ->> 'ok')::boolean, 'reordered save: ' || r::text;
  assert (select slot = 3 and consent_paper and alias = 'ТЕСТ-Тоглогч2' from cs2.players where id = v_pid),
         'ticks and alias moved with the person';
  assert (select (x ->> 'consent_paper')::boolean from jsonb_array_elements(r -> 'players') x where (x ->> 'slot')::int = 3),
         'class sees its consent tick';

  -- 7. injection strings are data, huge inputs are rejected cleanly
  r := cs2_api.class_save(c_tok, jsonb_build_object('expected_version', v + 2, 'players', jsonb_build_array(
         jsonb_build_object('slot', 1, 'first_name', 'Bob''; drop table x;--', 'surname_initial', 'T',
                            'steam_nickname', 'x''); delete from cs2.teams;--'))));
  assert r ->> 'error' = 'validation' and r -> 'errors' @> '[{"slot":1,"field":"first_name","code":"invalid"}]',
         'quotes in a name are invalid: ' || r::text;
  r := cs2_api.class_save(c_tok, jsonb_build_object('expected_version', v + 2, 'players', jsonb_build_array(
         jsonb_build_object('slot', 1, 'first_name', 'Robert', 'surname_initial', 'T',
                            'steam_nickname', 'x''); delete from cs2.teams;--', 'is_captain', true, 'age13', true))));
  assert (r ->> 'ok')::boolean and r -> 'players' -> 0 ->> 'steam_nickname' = 'x''); delete from cs2.teams;--',
         'nickname stored literally: ' || r::text;
  assert (select count(*) from cs2.teams) = 13 and (select count(*) from cs2.players where team_id = 99) = 1, 'nothing dropped';
  r := cs2_api.class_save(c_tok, jsonb_build_object('expected_version', v + 3, 'players', jsonb_build_array(
         jsonb_build_object('slot', 1, 'first_name', repeat('Ж', 100000), 'surname_initial', 'T', 'steam_nickname', 'big'))));
  assert r ->> 'error' = 'validation' and r -> 'errors' @> '[{"slot":1,"field":"first_name","code":"too_long"}]', '100k name';
  r := cs2_api.class_save(c_tok, jsonb_build_object('expected_version', v + 3, 'players',
         (select jsonb_agg(jsonb_build_object('slot', 100 + g, 'first_name', 'Bat')) from generate_series(1, 3000) g)));
  assert r ->> 'error' = 'validation' and r -> 'errors' = '[{"slot":null,"field":"players","code":"too_many"}]',
         '3000 cards rejected at once: ' || left(r::text, 200);
  r := cs2_api.class_save(c_tok, jsonb_build_object('expected_version', v + 3, 'players',
         (select jsonb_agg(jsonb_build_object('slot', 100 + g, 'first_name', 'Bat')) from generate_series(1, 12) g)));
  assert r ->> 'error' = 'validation' and jsonb_array_length(r -> 'errors') = 12, '12 cards are still parsed';
  r := cs2_api.class_save(c_tok, jsonb_build_object('expected_version', v + 3, 'players', jsonb_build_array(
         jsonb_build_object('slot', 1, 'first_name', 'Bat', 'surname_initial', 'T', 'steam_nickname', E'tab\there'))));
  assert r ->> 'error' = 'validation' and r -> 'errors' @> '[{"slot":1,"field":"steam_nickname","code":"invalid"}]',
         'control characters rejected';
  assert (select version from cs2.team_access where team_id = 99) = v + 3, 'failed saves do not change the version';
end $$;

rollback;
select 'PASS 02_roster' as result;
