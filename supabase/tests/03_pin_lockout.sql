-- 03_pin_lockout.sql — homeroom-teacher PIN (CONTRACT §4): 5 wrong within 15 min -> locked 15 min;
-- 10 wrong in total -> locked until the organiser's pin_reset; counters persist (errors are returned, never raised);
-- editing a confirmed roster needs the PIN and clears the confirmation. Hidden test team 99; rolled back.
begin;

do $$
declare
  c_tok    constant text := 'pin-test-token-0000000000001';
  c_att    constant jsonb := '{"enrolled":true,"age13":true,"own_steam":true,"rules":true}';
  c_roster constant jsonb := '[
    {"slot":1,"first_name":"Анар","surname_initial":"Б","steam_nickname":"pin-t1","is_captain":true,"age13":true},
    {"slot":2,"first_name":"Бат","surname_initial":"Д","steam_nickname":"pin-t2","age13":true},
    {"slot":3,"first_name":"Сараа","surname_initial":"Г","steam_nickname":"pin-t3","age13":true},
    {"slot":4,"first_name":"Төгс","surname_initial":"Э","steam_nickname":"pin-t4","age13":true},
    {"slot":5,"first_name":"Үүрцаг","surname_initial":"Ж","steam_nickname":"pin-t5","age13":true}]';
  r     jsonb;
  i     integer;
  v_pin text;
  a     cs2.team_access;
begin
  update cs2.settings set reg_closes_at = now() + interval '1 day', roster_freeze_at = now() + interval '2 days',
         tokens_valid_until = now() + interval '3 days', registration_open = true where id = 1;   -- date-independent window
  update cs2.team_access
     set token_sha256 = cs2.sha256_hex(c_tok), pin_bcrypt = extensions.crypt('4821', extensions.gen_salt('bf', 4))
   where team_id = 99;
  r := cs2_api.class_save(c_tok, jsonb_build_object('expected_version', (select version from cs2.team_access where team_id = 99),
                                                    'players', c_roster));
  assert (r ->> 'ok')::boolean and (r -> 'checks' ->> 'complete')::boolean, 'complete roster saved: ' || r::text;

  -- 1. requirements are checked before the PIN; empty or malformed PINs are not counted
  r := cs2_api.class_confirm(c_tok, '1111', c_att - 'rules');
  assert r ->> 'error' = 'validation' and r -> 'errors' @> '[{"field":"attest.rules","code":"required"}]', 'attestation: ' || r::text;
  assert cs2_api.class_confirm(c_tok, '', c_att) ->> 'error' = 'pin_required', 'empty PIN';
  assert cs2_api.class_confirm(c_tok, null, c_att) ->> 'error' = 'pin_required', 'null PIN';
  r := cs2_api.class_confirm(c_tok, '12a4', c_att);
  assert r ->> 'error' = 'pin_wrong' and (r ->> 'attempts_left')::integer = 5, 'malformed PIN not counted: ' || r::text;
  assert (select pin_fails_total from cs2.team_access where team_id = 99) = 0, 'no attempt counted so far';

  -- 2. 5 wrong within 15 min -> locked for 15 min (the right PIN is refused too)
  for i in 1..4 loop
    r := cs2_api.class_confirm(c_tok, '1111', c_att);
    assert r ->> 'error' = 'pin_wrong' and (r ->> 'attempts_left')::integer = 5 - i, 'wrong PIN #' || i || ': ' || r::text;
  end loop;
  r := cs2_api.class_confirm(c_tok, '1111', c_att);
  assert r ->> 'error' = 'pin_locked' and not (r ->> 'hard')::boolean
         and (r ->> 'until')::timestamptz = now() + interval '15 minutes', '5th wrong -> 15-min lock: ' || r::text;
  assert cs2_api.class_confirm(c_tok, '4821', c_att) ->> 'error' = 'pin_locked', 'right PIN refused while locked';
  select * into a from cs2.team_access where team_id = 99;
  assert a.pin_fails_total = 5 and a.confirmed_at is null and a.pin_locked_until = now() + interval '15 minutes',
         'counters persisted';
  r := cs2.state_json(true);
  assert (select x ->> 'pin_locked_until' from jsonb_array_elements(r -> 'teams') x where (x ->> 'id')::int = 99) is not null,
         'admin overview shows the PIN lock';

  -- 3. the lock expires -> the right PIN confirms; the 15-min window resets, the total stays
  update cs2.team_access set pin_locked_until = now() - interval '1 second' where team_id = 99;
  r := cs2_api.class_confirm(c_tok, '4821', c_att);
  assert (r ->> 'ok')::boolean and (r ->> 'confirmed_at')::timestamptz = now(), 'confirm after the lock: ' || r::text;
  select * into a from cs2.team_access where team_id = 99;
  assert a.confirmed_by = 'teacher' and a.pin_fails = 0 and a.pin_fails_total = 5 and a.confirm_attest = c_att,
         'confirmed by the teacher';
  assert exists (select 1 from cs2.audit_log where action = 'class_confirm' and team_id = 99), 'confirmation audited';

  -- 4. a confirmed roster: editing needs the PIN; a successful save clears the confirmation
  r := cs2_api.class_get(c_tok);
  assert r -> 'window' ->> 'reason' = 'confirmed' and (r -> 'window' ->> 'needs_pin')::boolean, 'window: confirmed, needs PIN';
  r := cs2_api.class_save(c_tok, jsonb_build_object('expected_version', a.version, 'players', c_roster));
  assert r ->> 'error' = 'pin_required', 'PIN required: ' || r::text;
  r := cs2_api.class_save(c_tok, jsonb_build_object('expected_version', a.version, 'pin', '9999', 'players', c_roster));
  assert r ->> 'error' = 'pin_wrong' and (r ->> 'attempts_left')::integer = 4, 'wrong PIN on save is counted: ' || r::text;
  r := cs2_api.class_save(c_tok, jsonb_build_object('expected_version', a.version, 'pin', '4821', 'players', c_roster));
  assert (r ->> 'ok')::boolean and r -> 'confirmed_at' = 'null'::jsonb and (r ->> 'version')::integer = a.version + 1,
         'save with the PIN clears the confirmation: ' || r::text;
  assert (select pin_fails_total from cs2.team_access where team_id = 99) = 6, 'total = 6';

  -- 5. 10 wrong in total -> hard lock until pin_reset
  for i in 1..3 loop
    r := cs2_api.class_confirm(c_tok, '2222', c_att);
    assert r ->> 'error' = 'pin_wrong', 'wrong PIN (total ' || (6 + i) || '): ' || r::text;
  end loop;
  assert (r ->> 'attempts_left')::integer = 1, 'one attempt left before the hard lock: ' || r::text;
  r := cs2_api.class_confirm(c_tok, '2222', c_att);
  assert r ->> 'error' = 'pin_locked' and (r ->> 'hard')::boolean and r -> 'until' = 'null'::jsonb,
         '10th wrong -> hard lock: ' || r::text;
  update cs2.team_access set pin_locked_until = null, pin_fail_times = '{}' where team_id = 99;
  assert cs2_api.class_confirm(c_tok, '4821', c_att) ->> 'error' = 'pin_locked', 'hard lock does not expire';
  r := cs2_api.class_save(c_tok, jsonb_build_object('expected_version', a.version + 1, 'players', c_roster));
  assert (r ->> 'ok')::boolean, 'an unconfirmed roster is still editable without the PIN: ' || r::text;
  r := cs2.state_json(true);
  assert (select (x ->> 'pin_hard_locked')::boolean from jsonb_array_elements(r -> 'teams') x where (x ->> 'id')::int = 99),
         'admin overview shows the hard lock';

  -- 6. organiser pin_reset -> new PIN, lock and counters cleared, old PIN invalid
  r := cs2.adm_pin_reset('admin:test', '{"team_id":99}');
  v_pin := r ->> 'pin';
  assert (r ->> 'ok')::boolean and v_pin ~ '^[0-9]{4}$', 'pin_reset: ' || r::text;
  select * into a from cs2.team_access where team_id = 99;
  assert not a.pin_hard_locked and a.pin_fails_total = 0 and a.pin_fails = 0 and a.pin_locked_until is null
         and a.pin_bcrypt = extensions.crypt(v_pin, a.pin_bcrypt) and a.pin_bcrypt <> v_pin, 'reset stored as bcrypt';
  if v_pin <> '4821' then
    assert cs2_api.class_confirm(c_tok, '4821', c_att) ->> 'error' = 'pin_wrong', 'old PIN no longer works';
  end if;
  r := cs2_api.class_confirm(c_tok, v_pin, c_att);
  assert (r ->> 'ok')::boolean, 'new PIN confirms: ' || r::text;
  assert cs2.adm_pin_reset('admin:test', '{"team_id":12345}') ->> 'error' = 'not_found', 'pin_reset unknown team';

  -- 7. no PIN issued yet -> forbidden (nothing counted)
  update cs2.team_access set pin_bcrypt = null, confirmed_at = null where team_id = 99;
  r := cs2_api.class_confirm(c_tok, '4821', c_att);
  assert r ->> 'error' = 'forbidden' and r ->> 'reason' = 'no_pin', 'no PIN issued: ' || r::text;

  -- 8. generated PINs are never trivial (0000, 1111, 1234, 4321 …)
  assert not exists (select 1 from generate_series(1, 500) g cross join lateral (select cs2.new_pin() as p) x
                      where x.p !~ '^[0-9]{4}$' or x.p ~ '^(.)\1{3}$'
                         or strpos('0123456789', x.p) > 0 or strpos('9876543210', x.p) > 0), 'PIN quality';
end $$;

rollback;
select 'PASS 03_pin_lockout' as result;
