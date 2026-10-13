-- 04_deadlines.sql — server-side deadlines (Asia/Ulaanbaatar) simulated by changing settings inside the transaction:
-- registration close, roster freeze, per-team unlock_until, registration switch, admin lock, token expiry.
-- Hidden test team 99 + a temporary organiser session; everything is rolled back.
begin;

do $$
declare
  c_tok    constant text := 'deadline-test-token-00000001';
  c_ses    constant text := 'deadline-test-session-000001';
  c_roster constant jsonb := '[{"slot":1,"first_name":"Анар","surname_initial":"Б","steam_nickname":"dl-t1","is_captain":true,"age13":true}]';
  r     jsonb;
  w     jsonb;
  v     integer;
  v_adm bigint;
begin
  update cs2.team_access set token_sha256 = cs2.sha256_hex(c_tok), pin_bcrypt = extensions.crypt('4821', extensions.gen_salt('bf', 4))
   where team_id = 99;
  insert into cs2.admins (label, secret_bcrypt) values ('deadline-test', extensions.crypt('deadline-test-secret', extensions.gen_salt('bf', 4)))
  returning id into v_adm;
  insert into cs2.admin_sessions (token_sha256, admin_id, expires_at) values (cs2.sha256_hex(c_ses), v_adm, now() + interval '1 hour');

  r := cs2_api.class_get(c_tok);
  v := (r ->> 'version')::integer;
  -- 0. the real schedule (only checkable before 2026-10-16 17:00 +08)
  if now() < '2026-10-16T17:00:00+08:00' then
    assert r -> 'window' ->> 'reason' = 'open' and (r -> 'window' ->> 'editable')::boolean
           and (r -> 'window' ->> 'closes_at')::timestamptz = '2026-10-16T17:00:00+08:00', 'open until 10.16 17:00: ' || r::text;
  end if;
  r := cs2_api.public_state(null);
  assert (r -> 'settings' ->> 'reg_closes_at')::timestamptz = (select reg_closes_at from cs2.settings)
         and (r -> 'settings' ->> 'consent_deadline_at')::timestamptz = (select consent_deadline_at from cs2.settings)
         and (r -> 'settings' ->> 'roster_freeze_at')::timestamptz = (select roster_freeze_at from cs2.settings), 'deadlines public';

  -- 1. registration deadline passed -> closed for save and confirm (no PIN attempt counted)
  r := cs2_api.admin(c_ses, 'settings_set', jsonb_build_object('reg_closes_at', now() - interval '1 minute'));
  assert (r ->> 'ok')::boolean and (r -> 'settings' ->> 'reg_closes_at')::timestamptz = now() - interval '1 minute',
         'settings_set: ' || r::text;
  w := cs2_api.class_get(c_tok) -> 'window';
  assert w ->> 'reason' = 'closed' and not (w ->> 'editable')::boolean and not (w ->> 'needs_pin')::boolean, 'closed: ' || w::text;
  r := cs2_api.class_save(c_tok, jsonb_build_object('expected_version', v, 'players', c_roster));
  assert r ->> 'error' = 'closed' and r ->> 'reason' = 'closed' and r ? 'closes_at', 'save refused after the deadline: ' || r::text;
  assert cs2_api.class_confirm(c_tok, '1111', '{}') ->> 'error' = 'closed', 'confirm refused after the deadline';
  assert (select pin_fails_total from cs2.team_access where team_id = 99) = 0, 'no PIN attempt counted';

  -- 2. per-team extension: unlock_until (string without offset = Ulaanbaatar time)
  r := cs2_api.admin(c_ses, 'unlock_until', jsonb_build_object('team_id', 99, 'until', to_char(now() at time zone 'Asia/Ulaanbaatar' + interval '1 hour', 'YYYY-MM-DD HH24:MI:SS')));
  assert (r ->> 'ok')::boolean and (r ->> 'unlocked_until')::timestamptz = date_trunc('second', now()) + interval '1 hour',
         'until read as Ulaanbaatar time: ' || r::text;
  w := cs2_api.class_get(c_tok) -> 'window';
  assert (w ->> 'editable')::boolean and w ->> 'reason' = 'open'
         and (w ->> 'closes_at')::timestamptz = date_trunc('second', now()) + interval '1 hour', 'unlocked: ' || w::text;
  r := cs2_api.class_save(c_tok, jsonb_build_object('expected_version', v, 'players', c_roster));
  assert (r ->> 'ok')::boolean, 'save while unlocked: ' || r::text;
  v := (r ->> 'version')::integer;
  assert cs2_api.admin(c_ses, 'unlock_until', '{"team_id":99,"until":"someday"}') ->> 'error' = 'validation', 'bad until';
  assert cs2_api.admin(c_ses, 'unlock_until', '{"team_id":12345,"until":null}') ->> 'error' = 'not_found', 'unknown team';

  -- 3. roster freeze (draw): the unlock still wins; without it -> frozen
  perform cs2_api.admin(c_ses, 'settings_set', jsonb_build_object('roster_freeze_at', now() - interval '1 second'));
  assert (cs2_api.class_get(c_tok) -> 'window' ->> 'editable')::boolean, 'unlock overrides the freeze';
  perform cs2_api.admin(c_ses, 'unlock_until', '{"team_id":99,"until":null}');
  w := cs2_api.class_get(c_tok) -> 'window';
  assert w ->> 'reason' = 'frozen' and not (w ->> 'editable')::boolean
         and (w ->> 'closes_at')::timestamptz = now() - interval '1 second', 'frozen: ' || w::text;
  r := cs2_api.class_save(c_tok, jsonb_build_object('expected_version', v, 'players', c_roster));
  assert r ->> 'error' = 'closed' and r ->> 'reason' = 'frozen', 'save refused when frozen: ' || r::text;

  -- 4. future deadlines, but the registration switch is off -> closed; on -> open
  perform cs2_api.admin(c_ses, 'settings_set', jsonb_build_object('reg_closes_at', now() + interval '1 day',
                        'roster_freeze_at', now() + interval '2 days', 'registration_open', false));
  assert cs2_api.class_get(c_tok) -> 'window' ->> 'reason' = 'closed', 'registration_open=false closes the window';
  assert (cs2_api.public_state(null) -> 'settings' ->> 'registration_open')::boolean = false, 'switch is public';
  perform cs2_api.admin(c_ses, 'settings_set', '{"registration_open":true}');
  assert cs2_api.class_get(c_tok) -> 'window' ->> 'reason' = 'open', 'reopened';

  -- 5. organiser lock beats everything
  r := cs2_api.admin(c_ses, 'lock', '{"team_id":99,"locked":true}');
  assert (r ->> 'ok')::boolean and (r ->> 'locked')::boolean, 'lock: ' || r::text;
  r := cs2_api.class_save(c_tok, jsonb_build_object('expected_version', v, 'players', c_roster));
  assert r ->> 'error' = 'locked' and r ->> 'reason' = 'locked', 'locked team: ' || r::text;
  assert cs2_api.admin(c_ses, 'lock', '{"team_id":99}') ->> 'error' = 'validation', 'locked flag required';
  perform cs2_api.admin(c_ses, 'lock', '{"team_id":99,"locked":false}');
  assert (cs2_api.class_get(c_tok) -> 'window' ->> 'editable')::boolean, 'unlocked again';

  -- 6. links expire (tokens_valid_until)
  perform cs2_api.admin(c_ses, 'settings_set', jsonb_build_object('tokens_valid_until', now() - interval '1 second'));
  assert cs2_api.class_get(c_tok) ->> 'error' = 'expired', 'class link expired';
  assert cs2_api.class_save(c_tok, '{}') ->> 'error' = 'expired', 'save after expiry';
  assert cs2_api.class_confirm(c_tok, '4821', '{}') ->> 'error' = 'expired', 'confirm after expiry';

  -- 7. settings validation
  r := cs2_api.admin(c_ses, 'settings_set', '{"reg_closes_at":"not-a-date","registration_open":"maybe","stream_url":"http://x.mn"}');
  assert r ->> 'error' = 'validation' and jsonb_array_length(r -> 'errors') = 3, 'three invalid settings: ' || r::text;
  assert cs2_api.admin(c_ses, 'settings_set', '{"consent_deadline_at":null}') ->> 'error' = 'validation', 'deadline not null';
  assert cs2_api.admin(c_ses, 'settings_set', jsonb_build_object('stream_url', 'https://x.mn/' || repeat('a', 400)))
         ->> 'error' = 'validation', 'stream link too long';
  r := cs2_api.admin(c_ses, 'settings_set', '{"stream_url":"  "}');
  assert (r ->> 'ok')::boolean and r -> 'settings' -> 'stream_url' = 'null'::jsonb, 'blank link clears it';
  assert exists (select 1 from cs2.audit_log where actor = 'admin:deadline-test' and action = 'settings_set'
                  and detail -> 'fields' ? 'reg_closes_at'), 'settings changes audited (field names only)';
end $$;

rollback;
select 'PASS 04_deadlines' as result;
