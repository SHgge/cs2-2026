-- cs2_14_bo3 — the final (19) and the 3rd-place match (20) are Bo3 (user decision 2026-10-24); every other match stays Bo1.
-- First to 2 maps wins the series; every map is a knockout map (MR12 + OT MR3, cs2.valid_score). Veto for Bo3 (coin-toss
-- winner = first): ban, ban, pick, pick, ban, ban → the map left is the decider; the sides alternate exactly as in Bo1.
-- matches.maps = [first's pick, other's pick, decider]; matches.games = [{a, b, map, at}] (at = when entered; public after
-- the same 120-s hold as results); score_a/score_b = maps won once the series is decided. New referee RPC
-- public.cs2_ref_games(p_token, p_no, p_games) = the FULL list of game results (idempotent).
-- Day 2: 19/20 now 14:30–17:15 (awards 17:30), class and referee links valid until 2026-10-25 20:00.
-- No GRANT/REVOKE/DROP/DELETE: new public/cs2_api functions get EXECUTE through the default privileges (as the other RPCs).

-- ---------------------------------------------------------------- columns
alter table cs2.matches add column if not exists best_of smallint not null default 1 check (best_of in (1, 3));
alter table cs2.matches add column if not exists maps text[];
alter table cs2.matches add column if not exists games jsonb not null default '[]'::jsonb
  check (jsonb_typeof(games) = 'array');

comment on column cs2.matches.best_of is 'Series length: 1 (Bo1) or 3 (Bo3: the final 19 and the 3rd-place match 20).';
comment on column cs2.matches.maps is 'Bo3 maps in play order: [first''s pick, other''s pick, decider] (filled as the veto goes).';
comment on column cs2.matches.games is 'Bo3 game results: [{"a":13,"b":9,"map":"<key>","at":"<ts>"}] (public 120 s after "at").';
comment on column cs2.matches.veto is 'Veto steps in order: [{"side":"a"|"b","map":"<key>"}] (Bo3 entries add "act":"ban"|"pick").';
comment on column cs2.matches.map is 'Bo1: the map left after the veto (null until the last ban). Bo3: null (see maps).';

update cs2.matches set best_of = 3 where no in (19, 20) and best_of <> 3;

-- ---------------------------------------------------------------- helpers
-- Veto act at a step: Bo3 picks at steps 2 and 3 (ban, ban, pick, pick, ban, ban …), everything else is a ban.
create or replace function cs2.veto_act(p_bo integer, p_step integer) returns text
language sql immutable set search_path = ''
as $$ select case when p_bo = 3 and p_step in (2, 3) then 'pick' else 'ban' end $$;

-- Bo3 maps from the veto: the picks in order, then the decider once exactly one map is left.
create or replace function cs2.veto_maps(p_veto jsonb, p_left text[]) returns text[]
language sql immutable set search_path = ''
as $$
  select coalesce((select array_agg(e.v ->> 'map' order by e.i)
                     from jsonb_array_elements(p_veto) with ordinality as e(v, i)
                    where e.v ->> 'act' = 'pick'), array[]::text[])
         || case when cardinality(p_left) = 1 then p_left else array[]::text[] end
$$;

-- Series tally of game results [{a, b}, …]: {"a": maps won, "b": maps won, "decided": bool, "bad": game no | null}.
-- bad = the first game that is not a valid knockout map score, or that comes after the series was already decided.
create or replace function cs2.series_tally(p_stage text, p_games jsonb) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  v_a  integer := 0;
  v_b  integer := 0;
  v_i  integer := 0;
  v_ga integer;
  v_gb integer;
  g    jsonb;
begin
  if p_games is null or jsonb_typeof(p_games) <> 'array' then
    return jsonb_build_object('a', 0, 'b', 0, 'decided', false, 'bad', 0);
  end if;
  for g in select e.v from jsonb_array_elements(p_games) with ordinality as e(v, i) order by e.i loop
    v_i := v_i + 1;
    v_ga := cs2.jint(g -> 'a');
    v_gb := cs2.jint(g -> 'b');
    if v_a >= 2 or v_b >= 2 or v_i > 3 or v_ga is null or v_gb is null or greatest(v_ga, v_gb) > 999
       or not cs2.valid_score(p_stage, v_ga, v_gb, null) then
      return jsonb_build_object('a', v_a, 'b', v_b, 'decided', false, 'bad', v_i);
    end if;
    if v_ga > v_gb then v_a := v_a + 1; else v_b := v_b + 1; end if;
  end loop;
  return jsonb_build_object('a', v_a, 'b', v_b, 'decided', v_a >= 2 or v_b >= 2, 'bad', null);
end $$;

-- [[a, b], …] of a games list (comparison / audit without the map and "at").
create or replace function cs2.games_ab(p_games jsonb) returns jsonb
language sql immutable set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_array(e.v -> 'a', e.v -> 'b') order by e.i), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p_games) = 'array' then p_games else '[]'::jsonb end)
       with ordinality as e(v, i)
$$;

-- A stored Bo3 result is consistent: a forfeit 0:2 / 2:0, or the games replay to exactly score_a:score_b (decided).
create or replace function cs2.series_ok(m cs2.matches) returns boolean
language sql stable set search_path = ''
as $$
  select case
    when m.forfeit in ('a', 'b') then
      m.score_a is not distinct from (case when m.forfeit = 'a' then 0 else 2 end)
      and m.score_b is not distinct from (case when m.forfeit = 'a' then 2 else 0 end)
    else coalesce((select (t.v ->> 'decided')::boolean and (t.v ->> 'bad') is null
                          and (t.v ->> 'a')::integer = m.score_a and (t.v ->> 'b')::integer = m.score_b
                     from (select cs2.series_tally(m.stage, m.games) as v) as t), false)
  end
$$;

-- ---------------------------------------------------------------- Bo3 result writer
-- Referees (cs2_ref_games / cs2_ref_report) and admins (match_result). p_games = the FULL list [{a, b}, …] (null = the
-- stored games). Undecided (1:0, 1:1) → status 'live' without a score; decided → p_status ('reported'|'final') with
-- score = maps won; p_forfeit 'a'|'b' (the side that lost) → 0:2 / 2:0 and no games. p_status 'live' = start / reopen
-- (keeps the games). A game keeps its "at" while its score is unchanged (its 120-s public hold does not restart).
create or replace function cs2.series_set(p_no integer, p_status text, p_games jsonb, p_forfeit text,
                                          p_team_a integer, p_team_b integer, p_actor text, p_role text)
returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  m         cs2.matches;
  v_f       text := nullif(nullif(lower(btrim(coalesce(p_forfeit, ''))), ''), 'false');
  v_list    jsonb;
  v_t       jsonb;
  v_games   jsonb := '[]'::jsonb;
  v_old     jsonb;
  v_status  text;
  v_a       integer;
  v_b       integer;
  v_ta      integer;
  v_tb      integer;
  v_changed boolean;
  v_i       integer := 0;
  g         jsonb;
begin
  if p_status is null or p_status not in ('live', 'reported', 'final') then
    return cs2.validation(jsonb_build_array(cs2.verr('action', 'invalid')));
  end if;
  select * into m from cs2.matches where no = p_no for update;
  if m.no is null then
    return cs2.err('not_found');
  end if;
  if m.best_of is distinct from 3 then
    return cs2.validation(jsonb_build_array(cs2.verr('action', 'invalid')));
  end if;
  if p_role = 'station' then
    if p_status = 'final' or m.status = 'final' then
      return cs2.err('forbidden', jsonb_build_object('reason', 'chief_only'));
    end if;
    if p_status = 'live' and m.status = 'reported' then
      return cs2.err('forbidden', jsonb_build_object('reason', 'already_reported'));
    end if;
  end if;

  if p_status = 'live' then
    update cs2.matches
       set status = 'live', score_a = null, score_b = null, ot = false, forfeit = null,
           reported_at = null, reported_by = null, updated_at = now()
     where no = p_no;
    perform cs2.bump_version();
    perform cs2.audit(p_actor, 'match_live', null, p_no,
                      jsonb_build_object('games', cs2.games_ab(m.games), 'role', p_role));
    return jsonb_build_object('ok', true, 'match', (select cs2.match_json(x, 'full') from cs2.matches x where x.no = p_no));
  end if;

  if v_f is null and p_games is null and m.forfeit is not null then
    v_f := m.forfeit;                                                -- re-report / finalise a stored forfeit
  end if;
  if v_f is not null then
    if v_f not in ('a', 'b') then
      return cs2.validation(jsonb_build_array(cs2.verr('forfeit', 'invalid')));
    end if;
    v_a := case when v_f = 'a' then 0 else 2 end;
    v_b := case when v_f = 'a' then 2 else 0 end;
    v_status := p_status;
  else
    v_list := coalesce(p_games, m.games);
    if jsonb_typeof(v_list) <> 'array' or jsonb_array_length(v_list) > 3 then
      return cs2.validation(jsonb_build_array(cs2.verr('games', 'invalid')));
    end if;
    v_t := cs2.series_tally(m.stage, v_list);
    if v_t ->> 'bad' is not null then
      return cs2.err('invalid_score', jsonb_build_object('game', (v_t ->> 'bad')::integer));
    end if;
    for g in select e.v from jsonb_array_elements(v_list) with ordinality as e(v, i) order by e.i loop
      v_i := v_i + 1;
      v_old := m.games -> (v_i - 1);
      v_games := v_games || jsonb_build_array(jsonb_build_object(
        'a', cs2.jint(g -> 'a'), 'b', cs2.jint(g -> 'b'), 'map', m.maps[v_i],
        'at', case when v_old ? 'at' and cs2.jint(v_old -> 'a') = cs2.jint(g -> 'a')
                        and cs2.jint(v_old -> 'b') = cs2.jint(g -> 'b')
                   then v_old -> 'at' else to_jsonb(now()) end));
    end loop;
    if (v_t ->> 'decided')::boolean then
      v_a := (v_t ->> 'a')::integer;
      v_b := (v_t ->> 'b')::integer;
      v_status := p_status;
    elsif p_status = 'final' then
      return cs2.err('invalid_score', jsonb_build_object('reason', 'undecided'));
    else
      v_status := 'live';                                            -- 1:0 / 1:1 — the series goes on
    end if;
  end if;

  v_ta := coalesce(p_team_a, m.team_a);                              -- knockout: stored for audit
  v_tb := coalesce(p_team_b, m.team_b);
  if (v_ta is not null and not exists (select 1 from cs2.teams t where t.id = v_ta and not t.is_hidden))
     or (v_tb is not null and not exists (select 1 from cs2.teams t where t.id = v_tb and not t.is_hidden))
     or v_ta = v_tb then
    return cs2.validation(jsonb_build_array(cs2.verr('team', 'invalid')));
  end if;

  if v_status = 'live' then
    update cs2.matches
       set status = 'live', games = v_games, score_a = null, score_b = null, ot = false, forfeit = null,
           team_a = v_ta, team_b = v_tb, reported_at = null, reported_by = null, updated_at = now()
     where no = p_no;
  else
    v_changed := m.reported_at is null or m.score_a is distinct from v_a or m.score_b is distinct from v_b
                 or m.forfeit is distinct from v_f or cs2.games_ab(m.games) is distinct from cs2.games_ab(v_games);
    update cs2.matches
       set status = v_status, games = v_games, score_a = v_a, score_b = v_b, ot = false, forfeit = v_f,
           team_a = v_ta, team_b = v_tb,
           reported_at = case when v_changed then now() else m.reported_at end,   -- new 120-s hold only on change
           reported_by = case when v_changed then p_actor else coalesce(m.reported_by, p_actor) end,
           updated_at = now()
     where no = p_no;
  end if;
  perform cs2.bump_version();
  perform cs2.audit(p_actor, 'match_' || v_status, null, p_no,
                    jsonb_build_object('games', cs2.games_ab(v_games), 'score_a', v_a, 'score_b', v_b,
                                       'forfeit', v_f, 'role', p_role));
  return jsonb_build_object('ok', true, 'match', (select cs2.match_json(x, 'full') from cs2.matches x where x.no = p_no));
end $$;

-- ---------------------------------------------------------------- match_set (08) + Bo3 redirect
-- Shared result writer for referees and admins. p_status 'live'|'reported'|'final'; p_role 'station'|'chief'|'admin'.
-- Bo3 matches go to cs2.series_set (live, forfeit, finalise); a round score on a Bo3 match is 'invalid_score'.
create or replace function cs2.match_set(p_no integer, p_status text, p_a integer, p_b integer, p_forfeit text,
                                         p_team_a integer, p_team_b integer, p_actor text, p_role text)
returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  m         cs2.matches;
  v_a       integer := p_a;
  v_b       integer := p_b;
  v_f       text := nullif(nullif(lower(btrim(coalesce(p_forfeit, ''))), ''), 'false');   -- '' / 'false' = none (as validScore)
  v_ta      integer;
  v_tb      integer;
  v_changed boolean;
begin
  if p_status is null or p_status not in ('live', 'reported', 'final') then
    return cs2.validation(jsonb_build_array(cs2.verr('action', 'invalid')));
  end if;
  select * into m from cs2.matches where no = p_no for update;
  if m.no is null then
    return cs2.err('not_found');
  end if;
  if m.best_of = 3 then                                              -- Bo3 (19, 20): the series writer
    if p_a is not null or p_b is not null then
      return cs2.err('invalid_score', jsonb_build_object('reason', 'series'));
    end if;
    return cs2.series_set(p_no, p_status, null, p_forfeit, p_team_a, p_team_b, p_actor, p_role);
  end if;
  if p_role = 'station' then
    if p_status = 'final' or m.status = 'final' then
      return cs2.err('forbidden', jsonb_build_object('reason', 'chief_only'));
    end if;
    if p_status = 'live' and m.status = 'reported' then
      return cs2.err('forbidden', jsonb_build_object('reason', 'already_reported'));
    end if;
  end if;
  if p_status <> 'live' and m.stage = 'group' and (m.team_a is null or m.team_b is null) then
    return cs2.err('draw_state', jsonb_build_object('reason', 'no_seats'));      -- no group result before the draw
  end if;

  if p_status = 'live' then
    update cs2.matches
       set status = 'live', score_a = null, score_b = null, ot = false, forfeit = null,
           reported_at = null, reported_by = null, updated_at = now()
     where no = p_no;
    v_a := null; v_b := null; v_f := null;
  else
    if v_f is not null and v_f not in ('a', 'b') then
      return cs2.validation(jsonb_build_array(cs2.verr('forfeit', 'invalid')));
    end if;
    if v_f is not null and v_a is null and v_b is null then          -- forfeit => 13:0 for the other side
      v_a := case when v_f = 'a' then 0 else 13 end;
      v_b := case when v_f = 'a' then 13 else 0 end;
    end if;
    if v_a is null and v_b is null and v_f is null and p_status = 'final' and m.score_a is not null then
      v_a := m.score_a; v_b := m.score_b; v_f := m.forfeit;          -- finalise the reported result
    end if;
    if not cs2.valid_score(m.stage, v_a, v_b, v_f) or greatest(v_a, v_b) > 999 then   -- 999: smallint-safe bound
      return cs2.err('invalid_score');
    end if;
    if m.stage = 'group' then                                        -- seats are authoritative
      v_ta := m.team_a;
      v_tb := m.team_b;
    else                                                             -- knockout: stored for audit
      v_ta := coalesce(p_team_a, m.team_a);
      v_tb := coalesce(p_team_b, m.team_b);
    end if;
    if (v_ta is not null and not exists (select 1 from cs2.teams t where t.id = v_ta and not t.is_hidden))
       or (v_tb is not null and not exists (select 1 from cs2.teams t where t.id = v_tb and not t.is_hidden))
       or v_ta = v_tb then
      return cs2.validation(jsonb_build_array(cs2.verr('team', 'invalid')));
    end if;
    v_changed := m.reported_at is null or m.score_a is distinct from v_a or m.score_b is distinct from v_b
                 or m.forfeit is distinct from v_f;
    update cs2.matches
       set status = p_status, score_a = v_a, score_b = v_b, forfeit = v_f,
           ot = (m.stage <> 'group' and v_f is null and greatest(v_a, v_b) >= 16),
           team_a = v_ta, team_b = v_tb,
           reported_at = case when v_changed then now() else m.reported_at end,   -- new 120-s hold only on change
           reported_by = case when v_changed then p_actor else coalesce(m.reported_by, p_actor) end,
           updated_at = now()
     where no = p_no;
  end if;
  perform cs2.bump_version();
  perform cs2.audit(p_actor, 'match_' || p_status, null, p_no,
                    jsonb_build_object('score_a', v_a, 'score_b', v_b, 'forfeit', v_f, 'role', p_role));
  return jsonb_build_object('ok', true, 'match', (select cs2.match_json(x, 'full') from cs2.matches x where x.no = p_no));
end $$;

-- ---------------------------------------------------------------- veto (13) + Bo3 picks
-- p_action: 'first' (p_side 'a'|'b'|'coin'; knockout, before the first step) | 'ban' / 'pick' (p_map; Bo3 picks at steps
-- 2–3, the act must match the step → else 'stale' {step, act}; optional p_side = the side the caller shows) | 'undo' (last
-- step) | 'reset'. p_step = number of steps the caller saw ('stale' on mismatch). Bo3: map stays null, maps = picks +
-- decider; once a game result is in, only an admin changes the veto ('games_started').
create or replace function cs2.veto_apply(p_no integer, p_action text, p_map text, p_step integer, p_side text,
                                          p_actor text, p_role text)
returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  m       cs2.matches;
  v_pool  text[];
  v_n     integer;
  v_bo    integer;
  v_act   text;
  v_first text;
  v_side  text;
  v_map   text := nullif(lower(btrim(coalesce(p_map, ''))), '');
  v_veto  jsonb;
  v_left  text[];
begin
  select * into m from cs2.matches where no = p_no for update;
  if m.no is null then
    return cs2.err('not_found');
  end if;
  if m.status = 'final' then
    return cs2.err('forbidden', jsonb_build_object('reason', 'final'));
  end if;
  if p_role = 'station' and m.status not in ('scheduled', 'live') then
    return cs2.err('forbidden', jsonb_build_object('reason', 'already_reported'));
  end if;
  v_bo := coalesce(m.best_of, 1);
  if v_bo = 3 and jsonb_array_length(m.games) > 0 and p_role is distinct from 'admin' then
    return cs2.err('forbidden', jsonb_build_object('reason', 'games_started'));
  end if;
  select s.map_pool into v_pool from cs2.settings s where s.id = 1;
  if v_bo = 3 and cardinality(v_pool) < 5 then
    return cs2.err('forbidden', jsonb_build_object('reason', 'pool_small'));
  end if;
  v_n := jsonb_array_length(m.veto);
  v_act := cs2.veto_act(v_bo, v_n);
  if p_step is not null and p_step <> v_n then
    return cs2.err('stale', jsonb_build_object('step', v_n, 'act', v_act));
  end if;
  v_first := coalesce(m.veto_first, case when m.stage = 'group' then 'a' end);

  case coalesce(p_action, '')
    when 'first' then
      if m.stage = 'group' then
        return cs2.err('forbidden', jsonb_build_object('reason', 'group_fixed'));
      end if;
      if v_n > 0 then
        return cs2.err('forbidden', jsonb_build_object('reason', 'veto_started'));
      end if;
      -- once decided, only admin changes it (a referee's repeated / stale toss must not re-toss; the chief resets)
      if m.veto_first is not null and p_role is distinct from 'admin' then
        return cs2.err('forbidden', jsonb_build_object('reason', 'first_set', 'veto_first', m.veto_first));
      end if;
      v_side := lower(btrim(coalesce(p_side, '')));
      if v_side = 'coin' then
        v_side := case when random() < 0.5 then 'a' else 'b' end;
        update cs2.matches set veto_first = v_side, veto_coin = true, updated_at = now() where no = p_no;
      elsif v_side in ('a', 'b') then
        update cs2.matches set veto_first = v_side, veto_coin = false, updated_at = now() where no = p_no;
      else
        return cs2.validation(jsonb_build_array(cs2.verr('side', 'invalid')));
      end if;

    when 'ban', 'pick' then
      if v_first is null then
        return cs2.err('forbidden', jsonb_build_object('reason', 'first_missing'));
      end if;
      if v_n >= cardinality(v_pool) - 1 then
        return cs2.err('forbidden', jsonb_build_object('reason', 'veto_done'));
      end if;
      if p_action <> v_act then                                      -- a ban tapped at a pick step (or vice versa)
        return cs2.err('stale', jsonb_build_object('step', v_n, 'act', v_act));
      end if;
      if v_map is null or not (v_map = any (v_pool)) then
        return cs2.validation(jsonb_build_array(cs2.verr('map', 'invalid')));
      end if;
      if exists (select 1 from jsonb_array_elements(m.veto) e where e ->> 'map' = v_map) then
        return cs2.validation(jsonb_build_array(cs2.verr('map', 'taken')));
      end if;
      v_side := case when v_n % 2 = 0 then v_first when v_first = 'a' then 'b' else 'a' end;
      -- p_side (optional) = the side the caller's screen shows; a coin re-tossed elsewhere → 'stale', nothing written
      if lower(btrim(coalesce(p_side, ''))) in ('a', 'b') and lower(btrim(p_side)) <> v_side then
        return cs2.err('stale', jsonb_build_object('step', v_n, 'act', v_act));
      end if;
      v_veto := m.veto || jsonb_build_array(case when v_bo = 3
                  then jsonb_build_object('side', v_side, 'map', v_map, 'act', v_act)
                  else jsonb_build_object('side', v_side, 'map', v_map) end);
      select array_agg(u.k order by u.ord) into v_left
        from unnest(v_pool) with ordinality as u(k, ord)
       where not exists (select 1 from jsonb_array_elements(v_veto) e where e ->> 'map' = u.k);
      update cs2.matches
         set veto = v_veto, veto_first = v_first,
             map = case when v_bo = 1 and cardinality(v_left) = 1 then v_left[1] end,
             maps = case when v_bo = 3 then cs2.veto_maps(v_veto, v_left) end,
             updated_at = now()
       where no = p_no;

    when 'undo' then
      if v_n = 0 then
        return cs2.err('forbidden', jsonb_build_object('reason', 'veto_empty'));
      end if;
      v_map := m.veto -> (v_n - 1) ->> 'map';
      v_veto := m.veto - (v_n - 1);
      update cs2.matches
         set veto = v_veto, map = null, maps = case when v_bo = 3 then cs2.veto_maps(v_veto, null) end, updated_at = now()
       where no = p_no;

    when 'reset' then
      if p_role = 'station' then
        return cs2.err('forbidden', jsonb_build_object('reason', 'chief_only'));
      end if;
      update cs2.matches
         set veto = '[]'::jsonb, map = null, maps = null, veto_first = null, veto_coin = false, updated_at = now()
       where no = p_no;

    else
      return cs2.validation(jsonb_build_array(cs2.verr('action', 'invalid')));
  end case;

  perform cs2.bump_version();
  perform cs2.audit(p_actor, 'veto_' || p_action, null, p_no,
                    jsonb_build_object('map', v_map, 'side', v_side, 'step', v_n, 'role', p_role));
  return jsonb_build_object('ok', true, 'match', (select cs2.match_json(x, 'full') from cs2.matches x where x.no = p_no));
end $$;

-- ---------------------------------------------------------------- json: Bo3 fields (public: games past the hold only)
create or replace function cs2.match_json(m cs2.matches, p_mode text) returns jsonb
language sql stable set search_path = ''
as $$
  select case when p_mode = 'public' then
    jsonb_build_object(
      'no', m.no, 'stage', m.stage, 'code', m.code, 'grp', m.grp, 'station', m.station,
      'start', m.start_at, 'end', m.end_at,
      'status', case when m.status in ('reported', 'final') and not v.vis then 'live' else m.status end,
      'score_a', case when v.vis then m.score_a end, 'score_b', case when v.vis then m.score_b end,
      'ot', case when v.vis then m.ot end, 'forfeit', case when v.vis then m.forfeit end,
      'team_a', m.team_a, 'team_b', m.team_b,
      'veto_first', m.veto_first, 'veto_coin', m.veto_coin, 'veto', m.veto, 'map', m.map,
      'best_of', m.best_of, 'maps', to_jsonb(m.maps), 'games', p.games)
  else
    jsonb_build_object(
      'no', m.no, 'day', m.day, 'stage', m.stage, 'code', m.code, 'grp', m.grp, 'station', m.station,
      'start', m.start_at, 'end', m.end_at, 'src_a', m.src_a, 'src_b', m.src_b, 'status', m.status,
      'score_a', m.score_a, 'score_b', m.score_b, 'ot', m.ot, 'forfeit', m.forfeit,
      'team_a', m.team_a, 'team_b', m.team_b, 'reported_at', m.reported_at, 'reported_by', m.reported_by,
      'veto_first', m.veto_first, 'veto_coin', m.veto_coin, 'veto', m.veto, 'map', m.map,
      'best_of', m.best_of, 'maps', to_jsonb(m.maps), 'games', m.games)
  end
  from (select m.status in ('reported', 'final') and m.reported_at is not null
               and m.reported_at <= now() - interval '120 seconds' as vis) as v,
       (select coalesce(jsonb_agg(jsonb_build_object('a', e.g -> 'a', 'b', e.g -> 'b', 'map', e.g -> 'map') order by e.i),
                        '[]'::jsonb) as games
          from jsonb_array_elements(m.games) with ordinality as e(g, i)
         where not exists (select 1 from jsonb_array_elements(m.games) with ordinality as h(g, i)    -- held prefix only
                            where h.i <= e.i
                              and coalesce((h.g ->> 'at')::timestamptz, '-infinity') > now() - interval '120 seconds')) as p
$$;

-- Public version also counts Bo3 games past the hold, so polling clients notice each game appear.
create or replace function cs2.public_version() returns bigint
language sql stable set search_path = ''
as $$
  select s.version * 100
         + (select count(*) from cs2.matches m
             where m.status in ('reported', 'final') and m.reported_at <= now() - interval '120 seconds')
         + (select count(*) from cs2.matches m, jsonb_array_elements(m.games) as g
             where coalesce((g ->> 'at')::timestamptz, '-infinity') <= now() - interval '120 seconds')
  from cs2.settings s where s.id = 1
$$;

-- ---------------------------------------------------------------- admin (08): match_result / match_update for Bo3
-- match_result {no, score_a, score_b, forfeit, ot, team_a, team_b, status:'reported'|'final'} (ot is derived);
-- Bo3: {no, games:[{a, b}], forfeit?, team_a?, team_b?, status} (no games + no forfeit + 'final' = finalise the stored series)
create or replace function cs2.adm_match_result(p_actor text, p_args jsonb) returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  v_status  text := coalesce(nullif(p_args ->> 'status', ''), 'reported');
  v_forfeit text := case when jsonb_typeof(p_args -> 'forfeit') = 'string' then p_args ->> 'forfeit' end;  -- null/false = none
  v_no      integer := cs2.jint(p_args -> 'no');
begin
  if v_status not in ('reported', 'final') then
    return cs2.validation(jsonb_build_array(cs2.verr('status', 'invalid')));
  end if;
  if exists (select 1 from cs2.matches x where x.no = v_no and x.best_of = 3) then
    return cs2.series_set(v_no, v_status, case when jsonb_typeof(p_args -> 'games') = 'array' then p_args -> 'games' end,
                          v_forfeit, cs2.jint(p_args -> 'team_a'), cs2.jint(p_args -> 'team_b'), p_actor, 'admin');
  end if;
  return cs2.match_set(v_no, v_status, cs2.jint(p_args -> 'score_a'), cs2.jint(p_args -> 'score_b'),
                       v_forfeit, cs2.jint(p_args -> 'team_a'), cs2.jint(p_args -> 'team_b'),
                       p_actor, 'admin');
end $$;

-- match_update {no, start?, station?, status?} — moving 'start' keeps the slot length; Bo3: 'scheduled' also clears
-- the games, 'live' keeps them, 'reported'/'final' need a consistent series (cs2.series_ok)
create or replace function cs2.adm_match_update(p_actor text, p_args jsonb) returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  m         cs2.matches;
  v_errs    jsonb := '[]'::jsonb;
  v_start   timestamptz;
  v_station text;
  v_status  text;
  v_clear   boolean;
begin
  select * into m from cs2.matches where no = cs2.jint(p_args -> 'no') for update;
  if m.no is null then
    return cs2.err('not_found');
  end if;
  if p_args ? 'start' then
    v_start := cs2.jts(p_args -> 'start');
    if v_start is null then
      v_errs := v_errs || jsonb_build_array(cs2.verr('start', 'invalid'));
    end if;
  end if;
  if p_args ? 'station' then
    v_station := p_args ->> 'station';
    if v_station is null or v_station not in ('A', 'B') then
      v_errs := v_errs || jsonb_build_array(cs2.verr('station', 'invalid'));
    end if;
  end if;
  if p_args ? 'status' then
    v_status := p_args ->> 'status';
    if v_status is null or v_status not in ('scheduled', 'live', 'reported', 'final') then
      v_errs := v_errs || jsonb_build_array(cs2.verr('status', 'invalid'));
    end if;
  end if;
  if jsonb_array_length(v_errs) > 0 then
    return cs2.validation(v_errs);
  end if;
  if v_status in ('reported', 'final') and not (case when m.best_of = 3 then cs2.series_ok(m)
                                                     else cs2.valid_score(m.stage, m.score_a, m.score_b, m.forfeit) end) then
    return cs2.err('invalid_score');
  end if;
  v_clear := v_status in ('scheduled', 'live');
  update cs2.matches
     set start_at = coalesce(v_start, start_at),
         end_at = case when v_start is not null then v_start + (end_at - start_at) else end_at end,
         station = coalesce(v_station, station),
         status = coalesce(v_status, status),
         score_a = case when v_clear then null else score_a end,
         score_b = case when v_clear then null else score_b end,
         forfeit = case when v_clear then null else forfeit end,
         ot = case when v_clear then false else ot end,
         games = case when v_status = 'scheduled' then '[]'::jsonb else games end,
         reported_at = case when v_clear then null
                            when v_status is not null and reported_at is null then now() else reported_at end,
         reported_by = case when v_clear then null else reported_by end,
         updated_at = now()
   where no = m.no;
  perform cs2.bump_version();
  perform cs2.audit(p_actor, 'match_update', null, m.no,
                    jsonb_build_object('start', v_start, 'station', v_station, 'status', v_status));
  return jsonb_build_object('ok', true, 'match', (select cs2.match_json(x, 'full') from cs2.matches x where x.no = m.no));
end $$;

-- ---------------------------------------------------------------- referee API: Bo3 game results
-- p_games = the FULL list of game results so far [{a, b}, …] (1–3; [] clears). Same token/station checks as ref_report;
-- undecided → 'live', decided → 'reported' (the chief then finalises with cs2_ref_report 'final').
create or replace function cs2_api.ref_games(p_token text, p_no integer, p_games jsonb default null) returns jsonb
language plpgsql volatile security definer
set search_path = '' set timezone = 'Asia/Ulaanbaatar'
as $$
declare
  r         cs2.referee_access;
  v_station text;
begin
  select * into r from cs2.ref_by_token(p_token);
  if r.id is null then
    return cs2.err('bad_token');
  end if;
  if now() < r.valid_from or now() > r.valid_until then
    return cs2.err('expired', jsonb_build_object('valid_from', r.valid_from, 'valid_until', r.valid_until));
  end if;
  select m.station into v_station from cs2.matches m where m.no = p_no;
  if v_station is null then
    return cs2.err('not_found');
  end if;
  if r.station is not null and v_station <> r.station then
    return cs2.err('forbidden', jsonb_build_object('reason', 'other_station'));
  end if;
  if p_games is null or jsonb_typeof(p_games) <> 'array' then
    return cs2.validation(jsonb_build_array(cs2.verr('games', 'invalid')));
  end if;
  return cs2.series_set(p_no, 'reported', p_games, null, null, null, 'ref:' || r.label,
                        case when r.station is null then 'chief' else 'station' end);
exception when others then
  raise log 'cs2_api.ref_games: % %', sqlstate, sqlerrm;
  return cs2.err('server', jsonb_build_object('sqlstate', sqlstate));
end $$;

create or replace function public.cs2_ref_games(p_token text, p_no integer, p_games jsonb default null) returns jsonb
language sql volatile security invoker set search_path = ''
as $$ select cs2_api.ref_games(p_token, p_no, p_games) $$;

comment on function public.cs2_ref_games(text, integer, jsonb)
  is 'Сургуулийн аварга – CS2 2026: referee Bo3 game results (full list, final 19 / 3rd place 20).';
comment on function public.cs2_ref_veto(text, integer, text, text, integer, text)
  is 'Сургуулийн аварга – CS2 2026: referee map veto (first / ban / pick / undo / reset).';

-- ---------------------------------------------------------------- day 2: Bo3 slot, links until 20:00
update cs2.matches
   set start_at = '2026-10-25 14:30:00+08', end_at = '2026-10-25 17:15:00+08', updated_at = now()
 where no in (19, 20) and (start_at, end_at) is distinct from ('2026-10-25 14:30:00+08'::timestamptz, '2026-10-25 17:15:00+08'::timestamptz);
update cs2.settings set tokens_valid_until = '2026-10-25 20:00:00+08' where id = 1 and tokens_valid_until < '2026-10-25 20:00:00+08';
update cs2.referee_access set valid_until = '2026-10-25 20:00:00+08' where valid_until = '2026-10-25 18:00:00+08';
alter table cs2.referee_access alter column valid_until set default '2026-10-25 20:00:00+08';
select cs2.bump_version();

notify pgrst, 'reload schema';
