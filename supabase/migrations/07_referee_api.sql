-- cs2_07_referee_api — referee links (#/ref/<token>), CONTRACT §4.
-- Station referee: own station, 'live' / 'report'. Chief (station null): all matches, also 'final'.
-- Valid 2026-10-24 07:00 +08 → 2026-10-25 18:00 +08 (referee_access.valid_from/valid_until).

-- Shared result writer for referees and admins. p_status 'live'|'reported'|'final'; p_role 'station'|'chief'|'admin'.
create or replace function cs2.match_set(p_no integer, p_status text, p_a integer, p_b integer, p_forfeit text,
                                         p_team_a integer, p_team_b integer, p_actor text, p_role text)
returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  m         cs2.matches;
  v_a       integer := p_a;
  v_b       integer := p_b;
  v_f       text := nullif(lower(btrim(coalesce(p_forfeit, ''))), '');
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
    if not cs2.valid_score(m.stage, v_a, v_b, v_f) then
      return cs2.err('invalid_score');
    end if;
    if m.stage = 'group' then                                        -- seats are authoritative
      v_ta := coalesce(m.team_a, p_team_a);
      v_tb := coalesce(m.team_b, p_team_b);
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
           ot = (m.stage <> 'group' and greatest(v_a, v_b) >= 16),
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

create or replace function cs2.ref_by_token(p_token text) returns cs2.referee_access
language sql stable set search_path = ''
as $$ select r.* from cs2.referee_access r where r.token_sha256 = cs2.token_hash(p_token) and r.active $$;

create or replace function cs2_api.ref_get(p_token text) returns jsonb
language plpgsql stable security definer
set search_path = '' set timezone = 'Asia/Ulaanbaatar'
as $$
declare
  r cs2.referee_access;
begin
  select * into r from cs2.ref_by_token(p_token);
  if r.id is null then
    return cs2.err('bad_token');
  end if;
  if now() < r.valid_from or now() > r.valid_until then
    return cs2.err('expired', jsonb_build_object('valid_from', r.valid_from, 'valid_until', r.valid_until));
  end if;
  return jsonb_build_object(
    'ok', true, 'label', r.label, 'station', r.station, 'chief', r.station is null, 'now', now(),
    'matches', (select coalesce(jsonb_agg(cs2.match_json(m, 'full') order by m.start_at, m.no), '[]'::jsonb)
                  from cs2.matches m
                 where r.station is null or m.station = r.station),
    'teams', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name,
                                                           'grp', t.grp, 'seat', t.seat) order by t.id), '[]'::jsonb)
                from cs2.teams t
               where not t.is_hidden));
exception when others then
  raise log 'cs2_api.ref_get: % %', sqlstate, sqlerrm;
  return cs2.err('server', jsonb_build_object('sqlstate', sqlstate));
end $$;

-- p_action: 'live' | 'report' | 'final' (chief only)
create or replace function cs2_api.ref_report(p_token text, p_no integer, p_action text,
                                              p_score_a integer default null, p_score_b integer default null,
                                              p_forfeit text default null,
                                              p_team_a integer default null, p_team_b integer default null)
returns jsonb
language plpgsql volatile security definer
set search_path = '' set timezone = 'Asia/Ulaanbaatar'
as $$
declare
  r         cs2.referee_access;
  v_station text;
  v_status  text;
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
  v_status := case p_action when 'live' then 'live' when 'report' then 'reported' when 'final' then 'final' end;
  if v_status is null then
    return cs2.validation(jsonb_build_array(cs2.verr('action', 'invalid')));
  end if;
  return cs2.match_set(p_no, v_status, p_score_a, p_score_b, p_forfeit, p_team_a, p_team_b,
                       'ref:' || r.label, case when r.station is null then 'chief' else 'station' end);
exception when others then
  raise log 'cs2_api.ref_report: % %', sqlstate, sqlerrm;
  return cs2.err('server', jsonb_build_object('sqlstate', sqlstate));
end $$;

-- ---------------------------------------------------------------- public wrappers
create or replace function public.cs2_ref_get(p_token text) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select cs2_api.ref_get(p_token) $$;

create or replace function public.cs2_ref_report(p_token text, p_no integer, p_action text,
                                                 p_score_a integer default null, p_score_b integer default null,
                                                 p_forfeit text default null,
                                                 p_team_a integer default null, p_team_b integer default null)
returns jsonb
language sql volatile security invoker set search_path = ''
as $$ select cs2_api.ref_report(p_token, p_no, p_action, p_score_a, p_score_b, p_forfeit, p_team_a, p_team_b) $$;

comment on function public.cs2_ref_get(text) is 'Ангийн аварга – CS2 2026: referee view by secret link token.';
comment on function public.cs2_ref_report(text, integer, text, integer, integer, text, integer, integer)
  is 'Ангийн аварга – CS2 2026: referee live/report/final.';

-- ---------------------------------------------------------------- grants
revoke all on function cs2_api.ref_get(text) from public;
revoke all on function cs2_api.ref_report(text, integer, text, integer, integer, text, integer, integer) from public;
grant execute on function cs2_api.ref_get(text),
                          cs2_api.ref_report(text, integer, text, integer, integer, text, integer, integer)
  to anon, authenticated;

revoke all on function public.cs2_ref_get(text) from public;
revoke all on function public.cs2_ref_report(text, integer, text, integer, integer, text, integer, integer) from public;
grant execute on function public.cs2_ref_get(text),
                          public.cs2_ref_report(text, integer, text, integer, integer, text, integer, integer)
  to anon, authenticated;

revoke all on all functions in schema cs2 from public, anon, authenticated;
