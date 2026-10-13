-- 08_admin.sql — organiser API through cs2_api.* exactly as the browser calls it (CONTRACT §4):
-- one-time setup (code consumed once, throttled), login throttle, sessions, overview shape, tokens/PINs issued once
-- (hashes stored), roster/consent/lock actions, exports, draw commit -> compute -> publish, match_result validation
-- (= logic.validScore), match_update, group lot/approve, announcements, settings, purge, sessions_revoke, logout.
-- The setup code hash is replaced by a test value inside the transaction. Everything is rolled back.
begin;

do $$
declare
  c_code   constant text := 'TEST-setup-code-2026';
  c_secret constant text := 'correct horse battery';
  c_label  constant text := 'Зохион байгуулагч';
  c_dsec   constant text := '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
  c_inputs constant jsonb := '{"12a":1234,"11a":5,"11b":987,"teachers":42,"10a":0,"10b":9999,"10v":313,"9a":777,"9b":2024,"8a":8,"8b":55,"8v":1001}';
  c_groups constant jsonb := '{"A":["teachers","9a","9b"],"B":["12a","10b","8v"],"V":["11b","10a","8a"],"G":["11a","10v","8b"]}';
  c_team1  constant jsonb := '[
    {"slot":1,"first_name":"Админбат","surname_initial":"А","steam_nickname":"12а | Adminbat","steam_id64":"76561190000000301","is_captain":true,"age13":true},
    {"slot":2,"first_name":"Болд","surname_initial":"Б","steam_nickname":"12а | Bold","steam_id64":"76561190000000302","age13":true},
    {"slot":3,"first_name":"Ганаа","surname_initial":"В","steam_nickname":"12а | Ganaa","steam_id64":"76561190000000303","age13":true},
    {"slot":4,"first_name":"Дулмаа","surname_initial":"Г","steam_nickname":"12а | Dulmaa","steam_id64":"76561190000000304","age13":true},
    {"slot":5,"first_name":"Энхээ","surname_initial":"Д","steam_nickname":"12а | Enkhee","steam_id64":"76561190000000305","age13":true},
    {"slot":6,"first_name":"Жаргал","surname_initial":"Е","steam_nickname":"12а | Jargal","age13":true}]';
  r      jsonb;
  t      jsonb;
  items  jsonb;
  s      text;
  s2     text;
  tok    text;
  ref    text;
  pid    bigint;
  pid2   bigint;
  v0     bigint;
  v1     bigint;
  i      integer;
begin
  assert not exists (select 1 from cs2.admins) and not exists (select 1 from cs2.draws where status <> 'void'),
         'test expects no admins and no active draw';
  select version into v0 from cs2.settings where id = 1;
  update cs2.settings set setup_code_hash = cs2.sha256_hex(c_code), setup_used_at = null,
         tokens_valid_until = greatest(tokens_valid_until, now() + interval '3 days') where id = 1;   -- test code, date-independent links

  -- 1. one-time setup
  r := cs2_api.admin_setup('wrong code', c_label, c_secret);
  assert r ->> 'error' = 'bad_code', 'bad code: ' || r::text;
  r := cs2_api.admin_setup(c_code, c_label, 'short');
  assert r ->> 'error' = 'validation' and r -> 'errors' @> '[{"field":"secret","code":"too_short"}]', 'secret >= 10: ' || r::text;
  r := cs2_api.admin_setup(c_code, '   ', c_secret);
  assert r ->> 'error' = 'validation' and r -> 'errors' @> '[{"field":"label","code":"required"}]', 'label required';
  assert (select setup_used_at is null from cs2.settings), 'failed attempts do not consume the code';
  r := cs2_api.admin_setup(' ' || c_code || ' ', '  Зохион   байгуулагч ', c_secret);
  assert (r ->> 'ok')::boolean and r ->> 'label' = c_label and not (r ? 'session'), 'setup ok: ' || r::text;
  assert (select setup_used_at = now() from cs2.settings), 'setup_used_at set';
  assert (select count(*) = 1 and bool_and(secret_bcrypt like '$2a$08$%' and secret_bcrypt <> c_secret) from cs2.admins),
         'one admin, bcrypt only';
  assert cs2_api.admin_setup(c_code, 'Second', c_secret) ->> 'error' = 'already_setup', 'the code works only once';
  assert (select count(*) from cs2.admins) = 1, 'still one admin';
  for i in 1..5 loop
    assert cs2_api.admin_setup('bad-' || i, 'x', c_secret) ->> 'error' = 'bad_code', 'bad code #' || i;
  end loop;
  r := cs2_api.admin_setup(c_code, 'x', c_secret);
  assert r ->> 'error' = 'throttled' and (r ->> 'until')::timestamptz = now() + interval '10 minutes', 'setup throttled: ' || r::text;

  -- 2. login: case-insensitive label, 12-h session (hash stored), 5 fails / 10 min per label -> throttled
  assert cs2_api.admin_login(c_label, 'wrong secret') ->> 'error' = 'bad_credentials', 'wrong secret';
  assert cs2_api.admin_login('nobody', c_secret) ->> 'error' = 'bad_credentials', 'unknown label';
  assert cs2_api.admin_login(null, null) ->> 'error' = 'bad_credentials', 'nulls';
  r := cs2_api.admin_login('ЗОХИОН БАЙГУУЛАГЧ', c_secret);
  s := r ->> 'session';
  assert (r ->> 'ok')::boolean and s ~ '^[A-Za-z0-9_-]{22}$' and (r ->> 'expires_at')::timestamptz = now() + interval '12 hours',
         'login ok: ' || r::text;
  assert exists (select 1 from cs2.admin_sessions where token_sha256 = cs2.sha256_hex(s))
         and not exists (select 1 from cs2.admin_sessions where token_sha256 = s), 'only the session hash is stored';
  for i in 1..5 loop
    assert cs2_api.admin_login(c_label, 'bad ' || i) ->> 'error' = 'bad_credentials', 'bad login #' || i;
  end loop;
  r := cs2_api.admin_login(c_label, c_secret);
  assert r ->> 'error' = 'throttled' and (r ->> 'until')::timestamptz = now() + interval '10 minutes', 'login throttled: ' || r::text;
  assert cs2_api.admin_login('nobody', 'x') ->> 'error' = 'bad_credentials', 'other labels are not throttled';
  assert (select count(*) from cs2.audit_log where action = 'admin_login_fail') = 6, 'failed logins of a real label audited';
  delete from cs2.throttle where key like 'login:%';
  r := cs2_api.admin_login(c_label, c_secret);
  s2 := r ->> 'session';
  assert (r ->> 'ok')::boolean and s2 <> s, 'second session';

  -- 3. sessions
  assert cs2_api.admin(null, 'overview', '{}') ->> 'error' = 'bad_session', 'null session';
  assert cs2_api.admin('not-a-session-token-000000', 'overview', '{}') ->> 'error' = 'bad_session', 'unknown session';
  update cs2.admin_sessions set expires_at = now() - interval '1 second' where token_sha256 = cs2.sha256_hex(s2);
  assert cs2_api.admin(s2, 'overview', '{}') ->> 'error' = 'bad_session', 'expired session';
  r := cs2_api.admin(s, 'no_such_action', '{}');
  assert r ->> 'error' = 'not_found' and r ->> 'action' = 'no_such_action', 'unknown action';
  assert (cs2_api.admin(s, 'overview', '"not an object"') ->> 'ok')::boolean, 'non-object args tolerated';

  -- 4. overview = public keys + private extras, unfiltered
  r := cs2_api.admin(s, 'overview', '{}');
  assert (select array_agg(k order by k) from jsonb_object_keys(r) k)
         = array['announcements', 'audit', 'decisions', 'draw', 'matches', 'now', 'ok', 'referees', 'settings', 'teams', 'version'],
         'overview keys: ' || (select string_agg(k, ',') from jsonb_object_keys(r) k);
  assert (r ->> 'version')::bigint = (select version from cs2.settings), 'raw settings version';
  assert jsonb_array_length(r -> 'teams') = 13, 'overview includes the hidden test team';
  t := (select x from jsonb_array_elements(r -> 'teams') x where (x ->> 'id')::int = 99);
  assert (t ->> 'is_hidden')::boolean and t ? 'players' and t ? 'checks' and t ? 'has_token' and t ? 'has_pin'
         and t ? 'pin_locked_until' and t ? 'pin_hard_locked' and t ? 'confirmed_at' and t ? 'confirmed_by' and t ? 'locked'
         and t ? 'unlocked_until' and t ? 'version' and t ? 'token_issued_at' and t ? 'reg' and t ? 'grp' and t ? 'seat',
         'overview team keys: ' || t::text;
  assert r -> 'settings' ? 'setup_used_at' and r -> 'settings' ? 'tokens_valid_until', 'private settings';
  assert jsonb_array_length(r -> 'matches') = 20 and r -> 'matches' -> 0 ? 'reported_at' and r -> 'matches' -> 0 ? 'src_a',
         'unfiltered matches';
  assert jsonb_array_length(r -> 'audit') between 10 and 50 and r -> 'audit' -> 0 ? 'actor', 'audit list';
  assert r -> 'referees' = '[]'::jsonb, 'no referees yet';

  -- 5. tokens & PINs: plaintext returned once, only hashes stored
  r := cs2_api.admin(s, 'tokens_issue', '{"kind":"class","team_id":99}');
  tok := r ->> 'token';
  assert (r ->> 'ok')::boolean and tok ~ '^[A-Za-z0-9_-]{22}$' and r ->> 'pin' ~ '^[0-9]{4}$' and (r ->> 'team_id')::int = 99
         and r ->> 'code' = 'test', 'class token: ' || r::text;
  assert (select token_sha256 = cs2.sha256_hex(tok) and pin_bcrypt = extensions.crypt(r ->> 'pin', pin_bcrypt)
            and token_sha256 <> tok and pin_bcrypt <> r ->> 'pin' from cs2.team_access where team_id = 99), 'hashes stored';
  assert cs2_api.class_get(tok) -> 'team' ->> 'code' = 'test', 'the token opens the class page';
  r := cs2_api.admin(s, 'tokens_issue', '{"kind":"class","team_id":99}');
  assert cs2_api.class_get(tok) ->> 'error' = 'bad_token', 'reissue invalidates the old link';
  assert (cs2_api.class_get(r ->> 'token') ->> 'ok')::boolean, 'the new link works';
  assert cs2_api.admin(s, 'tokens_issue', '{"kind":"class","team_id":12345}') ->> 'error' = 'not_found', 'unknown team';
  r := cs2_api.admin(s, 'tokens_issue', '{"kind":"class_all"}');
  items := r -> 'items';
  assert (r ->> 'ok')::boolean and jsonb_array_length(items) = 12, 'class_all: 12 items';
  assert (select count(distinct x ->> 'token') = 12 and bool_and(x ->> 'pin' ~ '^[0-9]{4}$') and bool_and((x ->> 'team_id')::int <> 99)
            from jsonb_array_elements(items) x), 'distinct tokens, PINs, no test team';
  assert (select bool_and(cs2_api.class_get(x ->> 'token') -> 'team' ->> 'code' = x ->> 'code') from jsonb_array_elements(items) x),
         'each token opens its own class';
  assert (select count(*) from cs2.team_access where token_sha256 is not null and pin_bcrypt is not null) = 13, 'all hold hashes';
  r := cs2_api.admin(s, 'tokens_issue', '{"kind":"referee","station":"A","label":"А станцын шүүгч"}');
  ref := r ->> 'token';
  assert (r ->> 'ok')::boolean and ref ~ '^[A-Za-z0-9_-]{22}$' and r ->> 'station' = 'A' and r ->> 'label' = 'А станцын шүүгч',
         'referee token: ' || r::text;
  assert (select token_sha256 = cs2.sha256_hex(ref) and valid_from = '2026-10-24T07:00:00+08:00' and valid_until = '2026-10-25T18:00:00+08:00'
            from cs2.referee_access where id = (r ->> 'id')::bigint), 'referee hash + event window';
  if now() < '2026-10-24T07:00:00+08:00' then
    assert cs2_api.ref_get(ref) ->> 'error' = 'expired', 'referee link works only on the event days';
  end if;
  update cs2.referee_access set valid_from = now() - interval '1 minute', valid_until = now() + interval '1 hour'
   where id = (r ->> 'id')::bigint;
  t := cs2_api.ref_get(ref);
  assert t ->> 'station' = 'A' and not (t ->> 'chief')::boolean
         and not exists (select 1 from jsonb_array_elements(t -> 'matches') x where x ->> 'station' <> 'A'), 'station view: ' || left(t::text, 300);
  r := cs2_api.admin(s, 'tokens_issue', '{"kind":"referee","station":null}');
  assert r -> 'station' = 'null'::jsonb and r ->> 'label' = 'Ерөнхий шүүгч', 'chief referee default label: ' || r::text;
  assert cs2_api.admin(s, 'tokens_issue', '{"kind":"referee","station":"C"}') ->> 'error' = 'validation', 'bad station';
  assert cs2_api.admin(s, 'tokens_issue', '{"kind":"nope"}') ->> 'error' = 'validation', 'bad kind';
  assert jsonb_array_length(cs2_api.admin(s, 'overview', '{}') -> 'referees') = 2, 'referees in the overview';
  r := cs2_api.admin(s, 'referee_revoke', jsonb_build_object('id', (select id from cs2.referee_access where station = 'A')));
  assert (r ->> 'ok')::boolean and cs2_api.ref_get(ref) ->> 'error' = 'bad_token', 'revoked referee link';
  r := cs2_api.admin(s, 'pin_reset', '{"team_id":1}');
  assert (r ->> 'ok')::boolean and r ->> 'pin' ~ '^[0-9]{4}$'
         and (select pin_bcrypt = extensions.crypt(r ->> 'pin', pin_bcrypt) from cs2.team_access where team_id = 1), 'pin_reset';

  -- 6. roster, consent ticks, confirmation, lock / unlock (team 1 = 12а)
  r := cs2_api.admin(s, 'team_save', jsonb_build_object('team_id', 1, 'expected_version', 999, 'players', c_team1));
  assert r ->> 'error' = 'version_conflict', 'team_save version check';
  r := cs2_api.admin(s, 'team_save', jsonb_build_object('team_id', 1, 'players', c_team1));
  assert (r ->> 'ok')::boolean and jsonb_array_length(r -> 'players') = 6 and (r -> 'checks' ->> 'complete')::boolean
         and r -> 'players' -> 0 ? 'id' and r -> 'players' -> 0 ? 'alias', 'team_save: ' || left(r::text, 300);
  pid := (r -> 'players' -> 0 ->> 'id')::bigint;
  pid2 := (r -> 'players' -> 1 ->> 'id')::bigint;
  r := cs2_api.admin(s, 'consent_set', jsonb_build_object('player_id', pid, 'consent_paper', true, 'consent_3a', true,
                                                          'consent_3b', false, 'consent_3v', true, 'alias', '  12а-Тоглогч1 '));
  assert (r ->> 'ok')::boolean and r -> 'player' ->> 'alias' = '12а-Тоглогч1' and r -> 'player' ->> 'consent_3b' = 'false'
         and (r -> 'player' ->> 'consent_paper')::boolean, 'consent_set: ' || r::text;
  r := cs2_api.admin(s, 'consent_set', jsonb_build_object('player_id', pid2, 'consent_paper', true, 'consent_3a', true,
                                                          'consent_3b', true));
  assert (r ->> 'ok')::boolean, 'consent_set #2';
  assert cs2_api.admin(s, 'consent_set', jsonb_build_object('player_id', pid, 'consent_3a', 'maybe')) ->> 'error' = 'validation', 'bad tick';
  assert cs2_api.admin(s, 'consent_set', jsonb_build_object('player_id', pid, 'alias', repeat('x', 33))) ->> 'error' = 'validation',
         'alias too long';
  assert cs2_api.admin(s, 'consent_set', '{"player_id":0}') ->> 'error' = 'not_found', 'unknown player';
  assert (cs2_api.public_state(null) -> 'teams' -> 0 -> 'reg' ->> 'consents')::int = 2, 'public consent count';
  assert cs2_api.admin(s, 'confirm_on_behalf', '{"team_id":1}') ->> 'error' = 'validation', 'reason required';
  r := cs2_api.admin(s, 'confirm_on_behalf', '{"team_id":1,"reason":"Цаасан маягт 04"}');
  assert (r ->> 'ok')::boolean and (select confirmed_by from cs2.team_access where team_id = 1) = 'admin:' || c_label, 'on behalf';
  r := cs2_api.admin(s, 'team_save', jsonb_build_object('team_id', 1, 'players', jsonb_set(c_team1, '{0,is_captain}', 'false')));
  assert (r ->> 'unconfirmed')::boolean and r -> 'confirmed_at' = 'null'::jsonb, 'no captain -> confirmation cleared';
  r := cs2_api.admin(s, 'team_save', jsonb_build_object('team_id', 1, 'players', c_team1));
  assert (select id = pid and alias = '12а-Тоглогч1' and consent_paper from cs2.players where team_id = 1 and slot = 1),
         'ticks and alias stay with the same person';
  r := cs2_api.admin(s, 'team_unconfirm', '{"team_id":1}');
  assert (r ->> 'ok')::boolean, 'team_unconfirm';
  r := cs2_api.admin(s, 'lock', '{"team_id":1,"locked":true}');
  assert (r ->> 'ok')::boolean and (select locked from cs2.team_access where team_id = 1), 'lock';
  r := cs2_api.admin(s, 'unlock_until', '{"team_id":1,"until":"2026-10-17 12:00"}');
  assert (r ->> 'unlocked_until')::timestamptz = '2026-10-17T12:00:00+08:00', 'until without offset = Ulaanbaatar time: ' || r::text;
  perform cs2_api.admin(s, 'lock', '{"team_id":1,"locked":false}');
  perform cs2_api.admin(s, 'unlock_until', '{"team_id":1,"until":null}');

  -- 7. exports: CSV-ready, hidden test team excluded, read-only (audited, no version bump)
  perform cs2.roster_write(99, '[{"slot":1,"first_name":"Hidden","surname_initial":"H","steam_nickname":"hidden-nick","steam_id64":"76561190000000999","is_captain":true,"age13":true}]');
  select version into v1 from cs2.settings where id = 1;
  r := cs2_api.admin(s, 'export', '{"kind":"roster"}');
  assert (r ->> 'ok')::boolean and r ->> 'kind' = 'roster' and jsonb_array_length(r -> 'columns') = 11
         and jsonb_array_length(r -> 'rows') = 6, 'roster export: ' || left(r::text, 300);
  assert r -> 'rows' -> 0 = jsonb_build_array('12а', '12a', 1, 'Үндсэн', 'Админбат', 'А', '12а | Adminbat', '76561190000000301',
                                              'Тийм', 'Тийм', '') and r -> 'rows' -> 5 ->> 3 = 'Нөөц' and r -> 'rows' -> 5 ->> 7 = '',
         'roster row: ' || (r -> 'rows' -> 0)::text;
  assert position('hidden-nick' in r::text) = 0, 'roster export excludes the test team';
  r := cs2_api.admin(s, 'export', '{"kind":"consent"}');
  assert jsonb_array_length(r -> 'rows') = 6 and jsonb_array_length(r -> 'columns') = 11, 'consent export';
  assert r -> 'rows' -> 0 = jsonb_build_array('12а', 1, 'Админбат', 'А', '12а | Adminbat', 'Тийм', 'Тийм', 'Үгүй', 'Тийм',
                                              '12а-Тоглогч1', '12а-Тоглогч1'), 'consent row 1 (3б no -> alias): ' || (r -> 'rows' -> 0)::text;
  assert r -> 'rows' -> 1 ->> 10 = '12а | Bold' and r -> 'rows' -> 2 ->> 10 = '12а-Тоглогч3', 'stream names: 3а+3б / fallback';
  r := cs2_api.admin(s, 'export', '{"kind":"results"}');
  assert jsonb_array_length(r -> 'rows') = 20 and jsonb_array_length(r -> 'columns') = 14 and r -> 'rows' -> 0 ->> 4 = '2026-10-24 09:45',
         'results export: ' || (r -> 'rows' -> 0)::text;
  r := cs2_api.admin(s, 'export', '{"kind":"matchzy"}');
  assert (select count(*) from jsonb_object_keys(r -> 'teams')) = 12 and not (r -> 'teams' ? 'test'), 'matchzy: 12 teams';
  assert r -> 'teams' -> '12a' ->> 'name' = '12а'
         and r -> 'teams' -> '12a' -> 'players' ->> '76561190000000301' = '12а-Тоглогч1'
         and r -> 'teams' -> '12a' -> 'players' ->> '76561190000000302' = '12а | Bold'
         and r -> 'teams' -> '12a' -> 'players' ->> '76561190000000303' = '12а-Тоглогч3', 'matchzy names: ' || (r -> 'teams' -> '12a')::text;
  assert r -> 'missing' = '[{"team":"12a","slot":6}]', 'players without SteamID listed: ' || (r -> 'missing')::text;
  assert (select version from cs2.settings) = v1, 'exports do not bump the version';
  assert (select count(*) from cs2.audit_log where action = 'export') = 4, 'exports audited';
  assert cs2_api.admin(s, 'export', '{"kind":"x"}') ->> 'error' = 'validation', 'bad export kind';

  -- 8. no group result before the draw; then draw commit -> compute -> publish (CONTRACT vector)
  r := cs2_api.admin(s, 'match_result', '{"no":1,"score_a":13,"score_b":5}');
  assert r ->> 'error' = 'draw_state' and r ->> 'reason' = 'no_seats', 'group result needs the draw: ' || r::text;
  r := cs2_api.admin(s, 'draw_commit', jsonb_build_object('commit', cs2.sha256_hex(c_dsec)));
  assert (r ->> 'ok')::boolean and r -> 'draw' ->> 'status' = 'committed', 'commit: ' || r::text;
  assert cs2_api.admin(s, 'draw_compute', jsonb_build_object('secret', repeat('0', 64), 'inputs', c_inputs)) ->> 'error' = 'bad_commit',
         'wrong secret';
  r := cs2_api.admin(s, 'draw_compute', jsonb_build_object('secret', c_dsec, 'inputs', c_inputs));
  assert (r ->> 'ok')::boolean and r -> 'draw' ->> 'seed' = '362b441a74ad4f47eb6726b0238f078c114ca567640a5b96ea517dfa3f7d5798'
         and r -> 'draw' -> 'groups' = c_groups and r -> 'draw' ? 'keys', 'compute: ' || left(r::text, 300);
  r := cs2_api.admin(s, 'draw_publish', '{}');
  assert (r ->> 'ok')::boolean and r -> 'draw' ->> 'status' = 'published', 'publish';
  assert cs2_api.public_state(null) -> 'draw' -> 'groups' = c_groups, 'public groups';

  -- 9. results: validation = logic.validScore
  assert cs2_api.admin(s, 'match_result', '{"no":1,"score_a":13,"score_b":12}') ->> 'error' = 'invalid_score', '13:12';
  assert cs2_api.admin(s, 'match_result', '{"no":1,"score_a":14,"score_b":12}') ->> 'error' = 'invalid_score', '14:12';
  assert cs2_api.admin(s, 'match_result', '{"no":1,"score_a":16,"score_b":14}') ->> 'error' = 'invalid_score', 'no OT in groups';
  assert cs2_api.admin(s, 'match_result', '{"no":1,"score_a":12,"score_b":12,"status":"live"}') ->> 'error' = 'validation',
         'status reported|final';
  r := cs2_api.admin(s, 'match_result', '{"no":1,"score_a":"12","score_b":12,"status":"reported","team_a":1,"team_b":2}');
  assert (r ->> 'ok')::boolean and r -> 'match' ->> 'status' = 'reported' and (r -> 'match' ->> 'team_a')::int = 4
         and (r -> 'match' ->> 'team_b')::int = 8 and not (r -> 'match' ->> 'ot')::boolean, '12:12; seats win over client teams: ' || r::text;
  r := cs2_api.admin(s, 'match_result', '{"no":2,"forfeit":"b","status":"final"}');
  assert (r ->> 'ok')::boolean and (r -> 'match' ->> 'score_a')::int = 13 and (r -> 'match' ->> 'score_b')::int = 0
         and r -> 'match' ->> 'forfeit' = 'b' and r -> 'match' ->> 'status' = 'final', 'forfeit: ' || r::text;
  assert cs2_api.admin(s, 'match_result', '{"no":2,"score_a":0,"score_b":13,"forfeit":"b"}') ->> 'error' = 'invalid_score',
         'the forfeiting side gets 0';
  assert cs2_api.admin(s, 'match_result', '{"no":2,"score_a":13,"score_b":0,"forfeit":"x"}') ->> 'error' = 'validation', 'forfeit a|b';
  r := cs2_api.admin(s, 'match_result', '{"no":3,"score_a":13,"score_b":11,"forfeit":false,"ot":true}');
  assert (r ->> 'ok')::boolean and not (r -> 'match' ->> 'ot')::boolean and r -> 'match' -> 'forfeit' = 'null'::jsonb,
         'forfeit false = none; ot derived from the score';
  assert cs2_api.admin(s, 'match_result', '{"no":13,"score_a":12,"score_b":12}') ->> 'error' = 'invalid_score', 'no draw in knockout';
  assert cs2_api.admin(s, 'match_result', '{"no":13,"score_a":17,"score_b":15}') ->> 'error' = 'invalid_score', '17:15';
  assert cs2_api.admin(s, 'match_result', '{"no":13,"score_a":16,"score_b":15}') ->> 'error' = 'invalid_score', '16:15';
  assert cs2_api.admin(s, 'match_result', '{"no":13,"score_a":16,"score_b":11}') ->> 'error' = 'invalid_score', '16:11';
  assert cs2_api.admin(s, 'match_result', '{"no":13,"score_a":13,"score_b":9,"team_a":4,"team_b":4}') ->> 'error' = 'validation',
         'same team twice';
  assert cs2_api.admin(s, 'match_result', '{"no":13,"score_a":13,"score_b":9,"team_a":99,"team_b":1}') ->> 'error' = 'validation',
         'the hidden team cannot play';
  r := cs2_api.admin(s, 'match_result', '{"no":13,"score_a":16,"score_b":14,"team_a":4,"team_b":1}');
  assert (r ->> 'ok')::boolean and (r -> 'match' ->> 'ot')::boolean and (r -> 'match' ->> 'team_a')::int = 4, '16:14 OT: ' || r::text;
  r := cs2_api.admin(s, 'match_result', '{"no":13,"score_a":17,"score_b":19,"status":"final"}');
  assert (r ->> 'ok')::boolean and (r -> 'match' ->> 'team_b')::int = 1, '17:19 OT final keeps the stored teams: ' || r::text;
  assert cs2_api.admin(s, 'match_result', '{"no":21,"score_a":13,"score_b":9}') ->> 'error' = 'not_found', 'unknown match';
  assert cs2.valid_score('group', 13, 11, null) and not cs2.valid_score('group', 13, 12, null) and cs2.valid_score('group', 12, 12, null)
     and not cs2.valid_score('qf', 12, 12, null) and cs2.valid_score('qf', 16, 14, null) and cs2.valid_score('sf', 16, 12, null)
     and not cs2.valid_score('final', 16, 15, null) and cs2.valid_score('third', 19, 17, null) and not cs2.valid_score('qf', 17, 15, null)
     and cs2.valid_score('third', 22, 18, null) and not cs2.valid_score('third', 22, 17, null)
     and cs2.valid_score('group', 0, 13, 'a') and cs2.valid_score('qf', 13, 0, 'b') and not cs2.valid_score('group', 13, 0, 'a')
     and not cs2.valid_score('group', 13, 0, 'x') and not cs2.valid_score('semi', 13, 0, null) and not cs2.valid_score('semi', 13, 0, 'b')
     and not cs2.valid_score('group', -1, 13, null) and not cs2.valid_score('group', null, 13, null) and cs2.valid_score('group', 11, 13, '')
     and not cs2.valid_score('group', null, null, 'a') and not cs2.valid_score(null, 13, 0, null), 'valid_score = logic.validScore';

  -- match_update: move keeps the slot length; reset clears the result
  r := cs2_api.admin(s, 'match_update', '{"no":20,"start":"2026-10-25 15:00","station":"A"}');
  assert (r -> 'match' ->> 'start')::timestamptz = '2026-10-25T15:00:00+08:00' and (r -> 'match' ->> 'end')::timestamptz = '2026-10-25T16:15:00+08:00'
         and r -> 'match' ->> 'station' = 'A', 'move: ' || r::text;
  assert cs2_api.admin(s, 'match_update', '{"no":20,"station":"C"}') ->> 'error' = 'validation', 'bad station';
  assert cs2_api.admin(s, 'match_update', '{"no":20,"start":"later"}') ->> 'error' = 'validation', 'bad start';
  assert cs2_api.admin(s, 'match_update', '{"no":20,"status":"final"}') ->> 'error' = 'invalid_score', 'final needs a score';
  assert cs2_api.admin(s, 'match_update', '{"no":99}') ->> 'error' = 'not_found', 'unknown match';
  r := cs2_api.admin(s, 'match_update', '{"no":1,"status":"scheduled"}');
  assert r -> 'match' ->> 'status' = 'scheduled' and r -> 'match' -> 'score_a' = 'null'::jsonb and r -> 'match' -> 'reported_at' = 'null'::jsonb,
         'reset clears the result';
  assert cs2_api.admin(s, 'draw_void', '{"reason":"x"}') ->> 'error' = 'draw_state', 'no void after group results';

  -- 10. group lot & approval
  assert cs2_api.admin(s, 'group_lot', '{"grp":"X","order":[4,8,9],"reason":"x"}') ->> 'error' = 'validation', 'bad group';
  assert cs2_api.admin(s, 'group_lot', '{"grp":"A","order":[4,8,1],"reason":"x"}') ->> 'error' = 'validation', 'team of another group';
  assert cs2_api.admin(s, 'group_lot', '{"grp":"A","order":[4,4,9],"reason":"x"}') ->> 'error' = 'validation', 'duplicate team';
  assert cs2_api.admin(s, 'group_lot', '{"grp":"A","order":[4],"reason":"x"}') ->> 'error' = 'validation', 'at least two teams';
  assert cs2_api.admin(s, 'group_lot', '{"grp":"A","order":[4,8,9]}') ->> 'error' = 'validation', 'reason required';
  r := cs2_api.admin(s, 'group_lot', '{"grp":"A","order":[9,4,8],"reason":"Ерөнхий шүүгчийн шодоо"}');
  assert (r ->> 'ok')::boolean and r -> 'lot' = '[9,4,8]', 'lot saved: ' || r::text;
  assert cs2_api.public_state(null) -> 'decisions' -> 'A' = '{"lot":[9,4,8],"approved":false}', 'public decision';
  r := cs2_api.admin(s, 'group_lot', '{"grp":"B","order":[6,1],"reason":"2 багийн шодоо"}');
  assert (r ->> 'ok')::boolean, 'two-team lot';
  r := cs2_api.admin(s, 'group_approve', '{"grp":"A","approved":true}');
  assert (r ->> 'ok')::boolean and (cs2_api.public_state(null) -> 'decisions' -> 'A' ->> 'approved')::boolean, 'approved';
  assert cs2_api.admin(s, 'group_approve', '{"grp":"A"}') ->> 'error' = 'validation', 'approved flag required';
  r := cs2_api.admin(s, 'group_lot', '{"grp":"A","order":null}');
  assert cs2_api.public_state(null) -> 'decisions' -> 'A' -> 'lot' = 'null'::jsonb, 'lot cleared';

  -- 11. announcements & settings
  r := cs2_api.admin(s, 'announce', '{"text":"  Сугалаа   16:00-д  ","level":"warn"}');
  assert (r ->> 'ok')::boolean and cs2_api.public_state(null) -> 'announcements' -> 0 ->> 'text' = 'Сугалаа 16:00-д', 'announce';
  assert cs2_api.admin(s, 'announce', jsonb_build_object('text', repeat('я', 501))) ->> 'error' = 'validation', 'too long';
  assert cs2_api.admin(s, 'announce', '{"text":"   "}') ->> 'error' = 'validation', 'empty';
  assert cs2_api.admin(s, 'announce', '{"text":"x","level":"danger"}') ->> 'error' = 'validation', 'bad level';
  r := cs2_api.admin(s, 'announce_hide', jsonb_build_object('id', (r ->> 'id')::bigint));
  assert (r ->> 'ok')::boolean and cs2_api.public_state(null) -> 'announcements' = '[]'::jsonb, 'hidden';
  assert cs2_api.admin(s, 'announce_hide', jsonb_build_object('id', (r ->> 'id')::bigint)) ->> 'error' = 'not_found', 'hide once';
  r := cs2_api.admin(s, 'settings_set', '{"stream_url":"https://www.facebook.com/test/live","registration_open":false}');
  assert (r ->> 'ok')::boolean and cs2_api.public_state(null) -> 'settings' ->> 'stream_url' = 'https://www.facebook.com/test/live'
         and not (cs2_api.public_state(null) -> 'settings' ->> 'registration_open')::boolean, 'settings public';
  assert cs2_api.admin(s, 'settings_set', '{"stream_url":"javascript:alert(1)"}') ->> 'error' = 'validation', 'https links only';

  -- 12. every mutation bumped the version and was audited; no player data in the audit log
  assert (select version from cs2.settings) = v0 + 36, '36 mutations = 36 version bumps: ' || (select version from cs2.settings) - v0;
  assert (select count(*) from cs2.audit_log where actor = 'admin:' || c_label) >= 36 + 4, 'mutations and exports audited';
  assert not exists (select 1 from cs2.audit_log where (detail::text || actor) ~ '(Админбат|Болд|Hidden|Adminbat|hidden-nick|7656119)'),
         'no player data in the audit log';

  -- 13. purge
  assert cs2_api.admin(s, 'purge', '{"phase":"stream"}') ->> 'error' = 'validation', 'confirm text required';
  assert cs2_api.admin(s, 'purge', '{"phase":"stream","confirm":"устгах"}') ->> 'error' = 'validation', 'exact confirm text';
  assert cs2_api.admin(s, 'purge', '{"phase":"all","confirm":"УСТГАХ"}') ->> 'error' = 'validation', 'bad phase';
  r := cs2_api.admin(s, 'purge', '{"phase":"stream","confirm":"УСТГАХ"}');
  assert (r ->> 'ok')::boolean and (r ->> 'ticks')::int = 2, 'stream purge: ' || r::text;
  assert not exists (select 1 from cs2.players where alias is not null or consent_3a is not null or consent_3b is not null or consent_3v is not null)
         and (select stream_url from cs2.settings) is null and (select count(*) from cs2.players) = 7
         and (select count(*) from cs2.players where consent_paper) = 2, 'stream data gone, rest kept';
  perform cs2_api.admin(s, 'tokens_issue', '{"kind":"referee","station":"B","label":"Б станц — Бат"}');
  r := cs2_api.admin_login(c_label, c_secret);
  s2 := r ->> 'session';
  r := cs2_api.admin(s, 'purge', '{"phase":"personal","confirm":"УСТГАХ"}');
  assert (r ->> 'ok')::boolean and (r ->> 'players')::int = 7 and (r ->> 'referees')::int = 3 and (r ->> 'sessions')::int >= 1,
         'personal purge: ' || r::text;
  assert not exists (select 1 from cs2.players)
         and not exists (select 1 from cs2.team_access where token_sha256 is not null or pin_bcrypt is not null or confirmed_at is not null
                                                          or confirm_reason is not null or confirmed_by is not null)
         and not exists (select 1 from cs2.referee_access) and not exists (select 1 from cs2.throttle), 'personal data gone';
  assert not exists (select 1 from cs2.audit_log where actor like '%:%' and actor not like 'class:%')
         and not exists (select 1 from cs2.matches where reported_by like '%:%')
         and not exists (select 1 from cs2.announcements where created_by like '%:%'), 'person labels reduced to roles';
  assert cs2_api.admin(s2, 'overview', '{}') ->> 'error' = 'bad_session', 'other sessions ended';
  assert (cs2_api.admin(s, 'overview', '{}') ->> 'ok')::boolean, 'the caller stays logged in';
  assert exists (select 1 from cs2.matches where score_a is not null) and exists (select 1 from cs2.draws where status = 'published')
         and (select count(*) from cs2.teams) = 13, 'results, draw and teams kept';
  assert cs2_api.class_get(items -> 0 ->> 'token') ->> 'error' = 'bad_token', 'class links dead';

  -- 14. sessions_revoke / logout
  s2 := cs2_api.admin_login(c_label, c_secret) ->> 'session';
  r := cs2_api.admin(s, 'sessions_revoke', '{"keep_current":true}');
  assert (r ->> 'revoked')::int = 1 and cs2_api.admin(s2, 'overview', '{}') ->> 'error' = 'bad_session'
         and (cs2_api.admin(s, 'overview', '{}') ->> 'ok')::boolean, 'keep_current';
  s2 := cs2_api.admin_login(c_label, c_secret) ->> 'session';
  r := cs2_api.admin(s, 'sessions_revoke', '{}');
  assert (r ->> 'ok')::boolean and (r ->> 'revoked')::int = 2 and not exists (select 1 from cs2.admin_sessions), 'all sessions ended';
  assert cs2_api.admin(s, 'overview', '{}') ->> 'error' = 'bad_session', 'the caller is logged out too';
  s := cs2_api.admin_login(c_label, c_secret) ->> 'session';
  assert (cs2_api.admin_logout(s) ->> 'ok')::boolean and cs2_api.admin(s, 'overview', '{}') ->> 'error' = 'bad_session', 'logout';
  assert (cs2_api.admin_logout('garbage') ->> 'ok')::boolean and (cs2_api.admin_logout(null) ->> 'ok')::boolean, 'logout idempotent';
end $$;

rollback;
select 'PASS 08_admin' as result;
