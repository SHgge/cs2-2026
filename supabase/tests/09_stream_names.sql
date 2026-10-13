-- 09_stream_names.sql — the name in the game feed (MatchZy export and the consent CSV column «Дамжуулалтад харагдах нэр»):
-- the feed goes to the hall projector (form 05 row 3а) AND the online stream (row 3б), so the Steam name is used only
-- when BOTH rows are «Тийм»; otherwise the alias, else «<анги>-Тоглогч<slot>» («Багш-Тоглогч<slot>» for the teachers).
-- Same rule as docs/js/admin/util.js streamName() (migration cs2_11). Everything is rolled back.
begin;

do $$
declare
  r  jsonb;
  m  jsonb;
  v0 bigint;
begin
  select version into v0 from cs2.settings where id = 1;
  perform cs2.roster_write(10, cs2.roster_parse(10, '[
    {"slot":1,"first_name":"Анар","surname_initial":"А","steam_nickname":"8а | SnBoth","steam_id64":"76561190000000401","is_captain":true,"age13":true},
    {"slot":2,"first_name":"Бат","surname_initial":"Б","steam_nickname":"8а | SnNoProj","steam_id64":"76561190000000402","age13":true},
    {"slot":3,"first_name":"Ганаа","surname_initial":"В","steam_nickname":"8а | SnNoStream","steam_id64":"76561190000000403","age13":true},
    {"slot":4,"first_name":"Дорж","surname_initial":"Г","steam_nickname":"8а | SnUnmarked","steam_id64":"76561190000000404","age13":true},
    {"slot":5,"first_name":"Энхээ","surname_initial":"Д","steam_nickname":"8а | SnNothing","steam_id64":"76561190000000405","age13":true},
    {"slot":6,"first_name":"Жаргал","surname_initial":"Е","steam_nickname":"8а | SnNoSid","age13":true}]') -> 'players');
  update cs2.players set consent_paper = true, consent_3a = true,  consent_3b = true                     where team_id = 10 and slot = 1;
  update cs2.players set consent_paper = true, consent_3a = false, consent_3b = true, alias = '8а-Хоч2'  where team_id = 10 and slot = 2;
  update cs2.players set consent_paper = true, consent_3a = true,  consent_3b = false                    where team_id = 10 and slot = 3;
  update cs2.players set consent_paper = true, consent_3a = null,  consent_3b = true                     where team_id = 10 and slot = 4;
  perform cs2.roster_write(4, cs2.roster_parse(4, '[{"slot":2,"first_name":"Сараа","surname_initial":"Ж","steam_nickname":"Багш | SnTeacher","steam_id64":"76561190000000412","is_captain":true,"age13":true}]') -> 'players');

  -- 1. MatchZy
  r := cs2.adm_export('admin:test', '{"kind":"matchzy"}');
  assert (r ->> 'ok')::boolean, 'matchzy: ' || left(r::text, 300);
  m := r -> 'teams' -> '8a' -> 'players';
  assert m ->> '76561190000000401' = '8а | SnBoth', '3а + 3б -> Steam name: ' || m::text;
  assert m ->> '76561190000000402' = '8а-Хоч2', '3а «Үгүй» (projector) -> alias: ' || m::text;
  assert m ->> '76561190000000403' = '8а-Тоглогч3', '3б «Үгүй» -> automatic alias: ' || m::text;
  assert m ->> '76561190000000404' = '8а-Тоглогч4', '3а not marked -> automatic alias: ' || m::text;
  assert m ->> '76561190000000405' = '8а-Тоглогч5', 'nothing marked -> automatic alias: ' || m::text;
  assert r -> 'teams' -> 'teachers' -> 'players' ->> '76561190000000412' = 'Багш-Тоглогч2', 'teachers: «Багш-Тоглогч2»: '
         || (r -> 'teams' -> 'teachers')::text;
  assert r -> 'missing' = '[{"team":"8a","slot":6}]', 'no SteamID -> listed as missing: ' || (r -> 'missing')::text;
  assert position('SnNoProj' in r::text) = 0 and position('SnNoStream' in r::text) = 0 and position('SnUnmarked' in r::text) = 0
         and position('SnNothing' in r::text) = 0 and position('SnTeacher' in r::text) = 0, 'no Steam name without 3а + 3б';

  -- 2. consent CSV: same rule in «Дамжуулалтад харагдах нэр» (column 11)
  r := cs2.adm_export('admin:test', '{"kind":"consent"}');
  assert (select jsonb_agg(x ->> 10 order by (x ->> 1)::int) from jsonb_array_elements(r -> 'rows') x where x ->> 0 = '8а')
         = '["8а | SnBoth", "8а-Хоч2", "8а-Тоглогч3", "8а-Тоглогч4", "8а-Тоглогч5", "8а-Тоглогч6"]', 'consent rows: ' || (r -> 'rows')::text;
  assert (select x ->> 10 from jsonb_array_elements(r -> 'rows') x where x ->> 0 = 'Багш нарын баг') = 'Багш-Тоглогч2', 'teachers row';

  -- 3. read-only: audited, no version bump
  assert (select version from cs2.settings where id = 1) = v0, 'exports do not bump the version';
  assert (select count(*) from cs2.audit_log where actor = 'admin:test' and action = 'export') = 2, 'exports audited';
end $$;

rollback;
select 'PASS 09_stream_names' as result;
