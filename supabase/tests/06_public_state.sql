-- 06_public_state.sql — cs2_public_state privacy and the 120-second spoiler hold (CONTRACT §4):
-- no player names / Steam names / SteamIDs / aliases, hidden test team 99 excluded, version short-circuit,
-- scores visible only 120 s after the report (status 'live' meanwhile), admin overview unfiltered. Rolled back.
begin;

do $$
declare
  c_groups constant jsonb := '{"A":["teachers","9a","9b"],"B":["12a","10b","8v"],"V":["11b","10a","8a"],"G":["11a","10v","8b"]}';
  p   jsonb;
  txt text;
  m   jsonb;
  r   jsonb;
  v0  bigint;
  v1  bigint;
begin
  -- marker data in a real team (1 = 12а) and in the hidden test team
  perform cs2.roster_write(1, '[{"slot":1,"first_name":"Zorigmarker","surname_initial":"Q","steam_nickname":"12а | NickMarkerA","steam_id64":"76561190000000101","is_captain":true,"age13":true},
                                {"slot":2,"first_name":"Second","surname_initial":"S","steam_nickname":"12а | NickMarkerB","is_captain":false,"age13":true}]');
  perform cs2.roster_write(99, '[{"slot":1,"first_name":"Hiddenmarker","surname_initial":"W","steam_nickname":"ТЕСТ | NickMarkerT","steam_id64":"76561190000000199","is_captain":true,"age13":true}]');
  update cs2.players set alias = 'AliasMarker', consent_paper = true, consent_3b = false where team_id = 1 and slot = 1;
  update cs2.team_access set confirmed_at = now(), confirmed_by = 'teacher' where team_id in (1, 99);
  update cs2.team_access set token_sha256 = cs2.sha256_hex('public-test-token-0000000001') where team_id = 99;
  perform cs2.adm_announce('admin:test', '{"text":"Нийтийн зарлал","level":"warn"}');
  perform cs2.adm_announce('admin:test', '{"text":"Нуусан зарлал"}');
  perform cs2.adm_announce_hide('admin:test', jsonb_build_object('id', (select max(id) from cs2.announcements)));
  perform cs2.adm_settings_set('admin:test', '{"stream_url":"https://www.facebook.com/test/live"}');
  r := cs2.adm_draw_manual('admin:test', jsonb_build_object('reason', 'Туршилт', 'groups', c_groups));
  assert (r ->> 'ok')::boolean, 'draw: ' || r::text;

  -- 1. privacy
  p := cs2_api.public_state(null);
  txt := p::text;
  assert (p ->> 'ok')::boolean, 'ok';
  assert position('Zorigmarker' in txt) = 0 and position('Second' in txt) = 0 and position('Hiddenmarker' in txt) = 0, 'no names';
  assert position('NickMarker' in txt) = 0, 'no Steam names';
  assert position('AliasMarker' in txt) = 0, 'no aliases';
  assert txt !~ '7656119[0-9]{10}', 'no SteamIDs';
  assert position('ТЕСТ' in txt) = 0 and position('"test"' in txt) = 0 and position('public-test-token' in txt) = 0,
         'hidden team not public';
  assert jsonb_array_length(p -> 'teams') = 12
         and not exists (select 1 from jsonb_array_elements(p -> 'teams') t
                          where (t ->> 'id')::int = 99 or t ? 'players' or t ? 'version' or t ? 'has_token' or t ? 'is_hidden'),
         'teams: 12, counts only';
  assert (select array_agg(k order by k) from jsonb_object_keys(p -> 'teams' -> 0) k)
         = array['code', 'id', 'is_teachers', 'name', 'pot', 'reg'], 'team keys';
  assert (select t -> 'reg' from jsonb_array_elements(p -> 'teams') t where (t ->> 'id')::int = 1)
         = '{"players":2,"confirmed":true,"consents":1}', 'registration counts';
  assert (select array_agg(k order by k) from jsonb_object_keys(p) k)
         = array['announcements', 'decisions', 'draw', 'matches', 'now', 'ok', 'settings', 'teams', 'version'], 'top-level keys';
  assert (select array_agg(k order by k) from jsonb_object_keys(p -> 'settings') k)
         = array['consent_deadline_at', 'reg_closes_at', 'registration_open', 'roster_freeze_at', 'stream_url'], 'settings keys';
  assert p -> 'settings' ->> 'stream_url' = 'https://www.facebook.com/test/live', 'stream link public';
  assert jsonb_array_length(p -> 'announcements') = 1 and p -> 'announcements' -> 0 ->> 'level' = 'warn'
         and not (p -> 'announcements' -> 0 ? 'hidden_at'), 'hidden announcement not public';
  assert not exists (select 1 from jsonb_array_elements(p -> 'matches') x where x ? 'reported_at' or x ? 'reported_by' or x ? 'src_a'),
         'no report metadata';
  assert p -> 'draw' ->> 'status' = 'published' and p -> 'draw' -> 'groups' = c_groups
         and not (p -> 'draw' ? 'keys') and not (p -> 'draw' ? 'id'), 'draw public, admin fields hidden';
  assert p -> 'decisions' = '{"A":{"lot":null,"approved":false},"B":{"lot":null,"approved":false},"V":{"lot":null,"approved":false},"G":{"lot":null,"approved":false}}',
         'decisions';

  -- 2. version short-circuit
  v0 := (p ->> 'version')::bigint;
  assert cs2_api.public_state(v0) = jsonb_build_object('ok', true, 'version', v0, 'unchanged', true), 'unchanged';
  assert (cs2_api.public_state(v0 - 1) ->> 'teams') is not null, 'other version -> full state';

  -- 3. the 120-second hold
  r := cs2.match_set(1, 'reported', 13, 7, null, null, null, 'ref:RefMarker', 'station');
  assert (r ->> 'ok')::boolean and (r -> 'match' ->> 'team_a')::int = 4 and (r -> 'match' ->> 'team_b')::int = 8,
         'reported (teams from the seats): ' || r::text;
  p := cs2_api.public_state(null);
  m := (select x from jsonb_array_elements(p -> 'matches') x where (x ->> 'no')::int = 1);
  assert m ->> 'status' = 'live' and m -> 'score_a' = 'null'::jsonb and m -> 'score_b' = 'null'::jsonb
         and m -> 'ot' = 'null'::jsonb and m -> 'forfeit' = 'null'::jsonb, 'held: ' || m::text;
  v1 := (p ->> 'version')::bigint;
  assert v1 > v0, 'the report changes the public version';
  m := (select x from jsonb_array_elements(cs2.state_json(true) -> 'matches') x where (x ->> 'no')::int = 1);
  assert m ->> 'status' = 'reported' and (m ->> 'score_a')::int = 13 and m ->> 'reported_by' = 'ref:RefMarker',
         'admin overview unfiltered: ' || m::text;
  m := (select x from jsonb_array_elements(cs2_api.ref_get('x') -> 'matches') x limit 1);
  assert m is null, 'bad referee token sees nothing';

  update cs2.matches set reported_at = now() - interval '119 seconds' where no = 1;
  p := cs2_api.public_state(null);
  m := (select x from jsonb_array_elements(p -> 'matches') x where (x ->> 'no')::int = 1);
  assert m ->> 'status' = 'live' and m -> 'score_a' = 'null'::jsonb, '119 s: still held';
  assert (p ->> 'version')::bigint = v1, 'version unchanged while held';

  update cs2.matches set reported_at = now() - interval '120 seconds' where no = 1;
  p := cs2_api.public_state(v1);
  assert not coalesce((p ->> 'unchanged')::boolean, false) and (p ->> 'version')::bigint = v1 + 1,
         'hold expiry changes the public version without a write: ' || (p ->> 'version');
  m := (select x from jsonb_array_elements(p -> 'matches') x where (x ->> 'no')::int = 1);
  assert m ->> 'status' = 'reported' and (m ->> 'score_a')::int = 13 and (m ->> 'score_b')::int = 7
         and not (m ->> 'ot')::boolean and m -> 'forfeit' = 'null'::jsonb and (m ->> 'team_a')::int = 4, 'visible: ' || m::text;

  -- finalising an unchanged result keeps it visible; a changed result starts a new hold
  r := cs2.match_set(1, 'final', null, null, null, null, null, 'ref:ChiefMarker', 'chief');
  assert (r ->> 'ok')::boolean and r -> 'match' ->> 'status' = 'final', 'final: ' || r::text;
  m := (select x from jsonb_array_elements(cs2_api.public_state(null) -> 'matches') x where (x ->> 'no')::int = 1);
  assert m ->> 'status' = 'final' and (m ->> 'score_a')::int = 13, 'final visible at once (no change)';
  r := cs2.match_set(1, 'reported', 13, 9, null, null, null, 'admin:test', 'admin');
  m := (select x from jsonb_array_elements(cs2_api.public_state(null) -> 'matches') x where (x ->> 'no')::int = 1);
  assert m ->> 'status' = 'live' and m -> 'score_a' = 'null'::jsonb, 'corrected score is held again';
  r := cs2.match_set(2, 'reported', null, null, 'a', null, null, 'ref:RefMarker', 'station');
  assert (r ->> 'ok')::boolean and (r -> 'match' ->> 'score_a')::int = 0 and (r -> 'match' ->> 'score_b')::int = 13,
         'forfeit fills 0:13: ' || r::text;
  update cs2.matches set reported_at = now() - interval '5 minutes' where no = 2;
  m := (select x from jsonb_array_elements(cs2_api.public_state(null) -> 'matches') x where (x ->> 'no')::int = 2);
  assert m ->> 'forfeit' = 'a' and (m ->> 'score_b')::int = 13, 'forfeit visible after the hold';

  -- 4. station referee rules
  r := cs2.match_set(2, 'final', null, null, null, null, null, 'ref:RefMarker', 'station');
  assert r ->> 'error' = 'forbidden', 'only the chief referee finalises';
  r := cs2.match_set(2, 'live', null, null, null, null, null, 'ref:RefMarker', 'station');
  assert r ->> 'error' = 'forbidden' and r ->> 'reason' = 'already_reported', 'no reset of a reported match by a station';

  -- 5. nothing personal anywhere in the final public JSON
  txt := cs2_api.public_state(null)::text;
  assert position('RefMarker' in txt) = 0 and position('ChiefMarker' in txt) = 0 and position('admin:' in txt) = 0,
         'reporter labels are not public';
  assert position('Zorigmarker' in txt) = 0 and position('NickMarker' in txt) = 0 and position('AliasMarker' in txt) = 0
         and txt !~ '7656119[0-9]{10}', 'still no player data';
end $$;

rollback;
select 'PASS 06_public_state' as result;
