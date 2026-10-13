-- 05_confirm.sql — confirmation requirements (CONTRACT §4): 5–6 players with slots 1–5 filled, exactly one captain,
-- everyone 13+, all four attestations; organiser confirm_on_behalf / team_unconfirm / team_save keeps or clears
-- the confirmation. Hidden test team 99; everything is rolled back.
begin;

do $$
declare
  c_tok constant text := 'confirm-test-token-000000001';
  c_att constant jsonb := '{"enrolled":true,"age13":true,"own_steam":true,"rules":true}';
  c_six constant jsonb := '[
    {"slot":1,"first_name":"Анар","surname_initial":"Б","steam_nickname":"cf-1","age13":true},
    {"slot":2,"first_name":"Бат","surname_initial":"Д","steam_nickname":"cf-2","age13":true},
    {"slot":3,"first_name":"Сараа","surname_initial":"Г","steam_nickname":"cf-3","age13":true},
    {"slot":4,"first_name":"Төгс","surname_initial":"Э","steam_nickname":"cf-4","age13":true},
    {"slot":5,"first_name":"Үүрцаг","surname_initial":"Ж","steam_nickname":"cf-5","age13":true},
    {"slot":6,"first_name":"Номин","surname_initial":"З","steam_nickname":"cf-6","age13":true}]';
  r jsonb;
  v integer;
  e jsonb;
begin
  update cs2.settings set reg_closes_at = now() + interval '1 day', roster_freeze_at = now() + interval '2 days',
         tokens_valid_until = now() + interval '3 days', registration_open = true where id = 1;   -- date-independent window
  update cs2.team_access set token_sha256 = cs2.sha256_hex(c_tok), pin_bcrypt = extensions.crypt('5813', extensions.gen_salt('bf', 4))
   where team_id = 99;
  v := (select version from cs2.team_access where team_id = 99);

  -- 1. no players at all
  r := cs2_api.class_confirm(c_tok, '5813', c_att);
  assert r ->> 'error' = 'validation' and r -> 'errors' @> '[{"field":"players","code":"count"},{"slot":1,"field":"slot","code":"missing"},
         {"field":"is_captain","code":"missing"}]', 'empty roster: ' || r::text;

  -- 2. four players (no slot 5, no captain, one not 13+), attestations missing
  r := cs2_api.class_save(c_tok, jsonb_build_object('expected_version', v, 'players',
         jsonb_set(c_six #- '{5}' #- '{4}', '{3,age13}', 'false')));
  assert (r ->> 'ok')::boolean, 'saved 4: ' || r::text;
  v := (r ->> 'version')::integer;
  r := cs2_api.class_confirm(c_tok, '5813', '{"enrolled":true,"age13":true,"own_steam":"yes","rules":false}');
  e := r -> 'errors';
  assert r ->> 'error' = 'validation', 'validation: ' || r::text;
  assert e @> '[{"field":"players","code":"count"}]' and e @> '[{"slot":5,"field":"slot","code":"missing"}]'
         and e @> '[{"field":"is_captain","code":"missing"}]' and e @> '[{"slot":4,"field":"age13","code":"required"}]'
         and e @> '[{"field":"attest.own_steam","code":"required"}]' and e @> '[{"field":"attest.rules","code":"required"}]'
         and not (e @> '[{"field":"attest.enrolled"}]'), 'all reasons listed: ' || e::text;
  assert (select pin_fails_total from cs2.team_access where team_id = 99) = 0, 'no PIN attempt counted';

  -- 3. substitute only (slots 1-4 + 6): slot 5 must be filled
  r := cs2_api.class_save(c_tok, jsonb_build_object('expected_version', v, 'players',
         jsonb_set(c_six #- '{4}', '{0,is_captain}', 'true')));
  v := (r ->> 'version')::integer;
  r := cs2_api.class_confirm(c_tok, '5813', c_att);
  assert r ->> 'error' = 'validation' and r -> 'errors' = '[{"slot":5,"field":"slot","code":"missing"}]', 'slot 5 missing: ' || r::text;

  -- 4. 6 players (5 + substitute), one captain, all 13+ -> confirmed
  r := cs2_api.class_save(c_tok, jsonb_build_object('expected_version', v, 'players', jsonb_set(c_six, '{0,is_captain}', 'true')));
  assert (r ->> 'ok')::boolean and (r -> 'checks' ->> 'complete')::boolean, 'complete: ' || r::text;
  v := (r ->> 'version')::integer;
  r := cs2_api.class_confirm(c_tok, '5813', c_att);
  assert (r ->> 'ok')::boolean and (r ->> 'version')::integer = v + 1, 'confirmed: ' || r::text;
  v := v + 1;
  r := cs2_api.public_state(null);
  assert (select x -> 'reg' from jsonb_array_elements(r -> 'teams') x where (x ->> 'id')::int = 1) = '{"players":0,"confirmed":false,"consents":0}',
         'other teams untouched';
  assert not exists (select 1 from jsonb_array_elements(r -> 'teams') x where (x ->> 'id')::int = 99), 'test team never public';

  -- 5. organiser roster edits keep a still-valid confirmation and clear it otherwise
  r := cs2.adm_team_save('admin:test', jsonb_build_object('team_id', 99, 'expected_version', v,
         'players', jsonb_set(jsonb_set(c_six, '{0,is_captain}', 'true'), '{5,steam_nickname}', '"cf-6b"')));
  assert (r ->> 'ok')::boolean and not (r ->> 'unconfirmed')::boolean and r ->> 'confirmed_at' is not null, 'kept: ' || r::text;
  v := (r ->> 'version')::integer;
  r := cs2.adm_team_save('admin:test', jsonb_build_object('team_id', 99, 'expected_version', v, 'players', c_six));
  assert (r ->> 'ok')::boolean and (r ->> 'unconfirmed')::boolean and r -> 'confirmed_at' = 'null'::jsonb,
         'cleared when the captain is gone: ' || r::text;
  v := (r ->> 'version')::integer;
  r := cs2.adm_team_save('admin:test', jsonb_build_object('team_id', 99, 'expected_version', v - 1, 'players', c_six));
  assert r ->> 'error' = 'version_conflict' and (r ->> 'version')::integer = v, 'team_save version check';
  assert cs2.adm_team_save('admin:test', '{"team_id":12345,"players":[]}') ->> 'error' = 'not_found', 'unknown team';

  -- 6. confirm_on_behalf: reason required, roster rules still apply
  r := cs2.adm_confirm_on_behalf('admin:test', '{"team_id":99}');
  assert r ->> 'error' = 'validation' and r -> 'errors' @> '[{"field":"reason","code":"required"}]', 'reason required';
  r := cs2.adm_confirm_on_behalf('admin:test', '{"team_id":99,"reason":"Цаасан маягт 04"}');
  assert r ->> 'error' = 'validation' and r -> 'errors' @> '[{"field":"is_captain","code":"missing"}]', 'rules still apply: ' || r::text;
  perform cs2.adm_team_save('admin:test', jsonb_build_object('team_id', 99, 'players', jsonb_set(c_six, '{2,is_captain}', 'true')));
  r := cs2.adm_confirm_on_behalf('admin:test', '{"team_id":99,"reason":"Цаасан маягт 04"}');
  assert (r ->> 'ok')::boolean and r ->> 'confirmed_at' is not null, 'confirmed on behalf: ' || r::text;
  assert (select confirmed_by = 'admin:test' and confirm_reason = 'Цаасан маягт 04' and confirm_attest is null
            from cs2.team_access where team_id = 99), 'who and why recorded';
  assert (select detail = '{}'::jsonb from cs2.audit_log where action = 'confirm_on_behalf' order by id desc limit 1),
         'free-text reason kept out of the audit log';

  -- 7. team_unconfirm
  r := cs2.adm_team_unconfirm('admin:test', '{"team_id":99}');
  assert (r ->> 'ok')::boolean and (select confirmed_at is null and confirmed_by is null from cs2.team_access where team_id = 99),
         'unconfirmed';
  assert cs2.adm_team_unconfirm('admin:test', '{"team_id":12345}') ->> 'error' = 'not_found', 'unknown team';
  assert cs2_api.class_get(c_tok) -> 'window' ->> 'reason' = 'open', 'class sees the unconfirmed roster as open';
end $$;

rollback;
select 'PASS 05_confirm' as result;
