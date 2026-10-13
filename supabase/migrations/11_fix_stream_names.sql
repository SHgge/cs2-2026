-- cs2_11_fix_stream_names — privacy fix from the security verification (2026-10-13), applied after cs2_08..cs2_10.
-- The game feed (MatchZy names -> CSTV -> OBS) is shown on the hall projector (form 05 row 3а) AND on the open
-- Facebook stream (row 3б). A player's Steam name may therefore appear only when BOTH rows are «Тийм»; otherwise
-- the alias, else the automatic «<анги>-Тоглогч<slot>» («Багш-Тоглогч<slot>» for the teachers' team).
-- This is the rule of form 05 / doc 11 §8.7 and of docs/js/admin/util.js streamName(); cs2_08 used row 3б only.
-- Only the internal helper cs2.adm_export is replaced (CREATE OR REPLACE keeps its owner-only ACL from cs2_08);
-- nothing outside schema cs2 is touched.

create or replace function cs2.adm_export(p_actor text, p_args jsonb) returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  v_kind text := p_args ->> 'kind';
  v_res  jsonb;
begin
  if v_kind = 'roster' then
    v_res := jsonb_build_object(
      'columns', jsonb_build_array('Баг', 'Код', '№', 'Үүрэг', 'Нэр', 'Овгийн үсэг', 'Steam нэр', 'SteamID64',
                                   'Ахлагч', '13+ нас', 'Баталгаажсан'),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_array(t.name, t.code, p.slot,
                 case when p.slot <= 5 then 'Үндсэн' else 'Нөөц' end,
                 p.first_name, p.surname_initial, p.steam_nickname, coalesce(p.steam_id64, ''),
                 cs2.yes_no(p.is_captain), cs2.yes_no(p.age13), cs2.ts_local(a.confirmed_at))
                 order by t.id, p.slot)
          from cs2.players p
          join cs2.teams t on t.id = p.team_id
          join cs2.team_access a on a.team_id = t.id
         where not t.is_hidden), '[]'::jsonb));
  elsif v_kind = 'consent' then
    v_res := jsonb_build_object(
      'columns', jsonb_build_array('Баг', '№', 'Нэр', 'Овгийн үсэг', 'Steam нэр', 'Зөвшөөрөл (05)', '3а', '3б', '3в',
                                   'Хоч нэр', 'Дамжуулалтад харагдах нэр'),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_array(t.name, p.slot, p.first_name, p.surname_initial, p.steam_nickname,
                 cs2.yes_no(p.consent_paper), cs2.yes_no(p.consent_3a), cs2.yes_no(p.consent_3b),
                 cs2.yes_no(p.consent_3v), coalesce(p.alias, ''),
                 case when p.consent_3a is true and p.consent_3b is true then p.steam_nickname
                      else coalesce(p.alias, case when t.is_teachers then 'Багш' else t.name end || '-Тоглогч' || p.slot) end)
                 order by t.id, p.slot)
          from cs2.players p
          join cs2.teams t on t.id = p.team_id
         where not t.is_hidden), '[]'::jsonb));
  elsif v_kind = 'results' then
    v_res := jsonb_build_object(
      'columns', jsonb_build_array('№', 'Шат', 'Хэсэг', 'Станц', 'Эхлэх', 'Баг 1', 'Баг 2', 'Оноо 1', 'Оноо 2',
                                   'Нэмэлт цаг', 'Техникийн ялагдал', 'Төлөв', 'Мэдээлсэн', 'Мэдээлсэн цаг'),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_array(
                 m.no, coalesce(m.code, 'Хэсгийн тоглолт'),
                 case m.grp when 'A' then 'А' when 'B' then 'Б' when 'V' then 'В' when 'G' then 'Г' else '' end,
                 case m.station when 'A' then 'А' else 'Б' end,
                 cs2.ts_local(m.start_at), coalesce(ta.name, ''), coalesce(tb.name, ''),
                 coalesce(m.score_a::text, ''), coalesce(m.score_b::text, ''),
                 case when m.score_a is null then '' else cs2.yes_no(m.ot) end,
                 case m.forfeit when 'a' then coalesce(ta.name, 'A') when 'b' then coalesce(tb.name, 'B') else '' end,
                 case m.status when 'scheduled' then 'Товлосон' when 'live' then 'Явагдаж байна'
                               when 'reported' then 'Мэдээлсэн' when 'final' then 'Баталгаажсан' end,
                 coalesce(m.reported_by, ''), cs2.ts_local(m.reported_at))
                 order by m.no)
          from cs2.matches m
          left join cs2.teams ta on ta.id = m.team_a
          left join cs2.teams tb on tb.id = m.team_b), '[]'::jsonb));
  elsif v_kind = 'matchzy' then
    -- display = Steam name only with rows 3а (projector) AND 3б (online stream) = «Тийм», otherwise the alias
    v_res := jsonb_build_object(
      'teams', coalesce((
        select jsonb_object_agg(t.code, jsonb_build_object('name', t.name, 'players', coalesce((
                 select jsonb_object_agg(p.steam_id64,
                          case when p.consent_3a is true and p.consent_3b is true then p.steam_nickname
                               else coalesce(p.alias, case when t.is_teachers then 'Багш' else t.name end
                                                      || '-Тоглогч' || p.slot) end)
                   from cs2.players p
                  where p.team_id = t.id and p.steam_id64 is not null), '{}'::jsonb)))
          from cs2.teams t
         where not t.is_hidden), '{}'::jsonb),
      'missing', coalesce((
        select jsonb_agg(jsonb_build_object('team', t.code, 'slot', p.slot) order by t.id, p.slot)
          from cs2.players p
          join cs2.teams t on t.id = p.team_id
         where not t.is_hidden and p.steam_id64 is null), '[]'::jsonb));
  else
    return cs2.validation(jsonb_build_array(cs2.verr('kind', 'invalid')));
  end if;
  perform cs2.audit(p_actor, 'export', null, null, jsonb_build_object('kind', v_kind));   -- read-only: no version bump
  return jsonb_build_object('ok', true, 'kind', v_kind) || v_res;
end $$;
