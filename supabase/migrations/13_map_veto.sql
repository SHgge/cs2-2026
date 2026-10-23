-- cs2_13_map_veto — map veto on the referee's device (regulation 02 §7.9, SPEC §3, CONTRACT §4).
-- Pool: Valve Active Duty (settings.map_pool, 7 maps). Bans alternate first, other, first, … (3 + 3); the map left is
-- played. Group stage: the team listed first (side 'a') bans first; knockout: coin toss (system or referee), stored in
-- matches.veto_first. Station referees: own station, while the match is 'scheduled' or 'live'; 'reset' is chief/admin
-- only. Veto steps and the decided map are public at once (no 120-s hold).

-- ---------------------------------------------------------------- columns
alter table cs2.settings add column if not exists map_pool text[] not null
  default array['ancient', 'anubis', 'cache', 'dust2', 'inferno', 'mirage', 'nuke'];
alter table cs2.matches add column if not exists veto_first text check (veto_first in ('a', 'b'));
alter table cs2.matches add column if not exists veto_coin boolean not null default false;
alter table cs2.matches add column if not exists veto jsonb not null default '[]'::jsonb
  check (jsonb_typeof(veto) = 'array');
alter table cs2.matches add column if not exists map text;

comment on column cs2.settings.map_pool is 'Map veto pool (keys: ancient, anubis, cache, dust2, inferno, mirage, nuke).';
comment on column cs2.matches.veto_first is 'Side that bans first: group = a (listed first); knockout = coin toss.';
comment on column cs2.matches.veto_coin is 'veto_first was decided by the system coin toss.';
comment on column cs2.matches.veto is 'Bans in order: [{"side":"a"|"b","map":"<key>"}].';
comment on column cs2.matches.map is 'Map left after the veto (null until the last ban).';

-- ---------------------------------------------------------------- core
-- p_action: 'first' (p_side 'a'|'b'|'coin'; knockout, before the first ban) | 'ban' (p_map; optional p_side = the
-- side the caller shows banning, else 'stale') | 'undo' (last ban) | 'reset'. p_step = number of bans the caller saw
-- (optional guard against double taps / two devices → 'stale'). p_role: 'station' | 'chief' | 'admin'.
create or replace function cs2.veto_apply(p_no integer, p_action text, p_map text, p_step integer, p_side text,
                                          p_actor text, p_role text)
returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  m       cs2.matches;
  v_pool  text[];
  v_n     integer;
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
  select s.map_pool into v_pool from cs2.settings s where s.id = 1;
  v_n := jsonb_array_length(m.veto);
  if p_step is not null and p_step <> v_n then
    return cs2.err('stale', jsonb_build_object('step', v_n));
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

    when 'ban' then
      if v_first is null then
        return cs2.err('forbidden', jsonb_build_object('reason', 'first_missing'));
      end if;
      if v_n >= cardinality(v_pool) - 1 then
        return cs2.err('forbidden', jsonb_build_object('reason', 'veto_done'));
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
        return cs2.err('stale', jsonb_build_object('step', v_n));
      end if;
      v_veto := m.veto || jsonb_build_array(jsonb_build_object('side', v_side, 'map', v_map));
      select array_agg(u.k order by u.ord) into v_left
        from unnest(v_pool) with ordinality as u(k, ord)
       where not exists (select 1 from jsonb_array_elements(v_veto) e where e ->> 'map' = u.k);
      update cs2.matches
         set veto = v_veto, veto_first = v_first,
             map = case when cardinality(v_left) = 1 then v_left[1] end, updated_at = now()
       where no = p_no;

    when 'undo' then
      if v_n = 0 then
        return cs2.err('forbidden', jsonb_build_object('reason', 'veto_empty'));
      end if;
      v_map := m.veto -> (v_n - 1) ->> 'map';
      update cs2.matches set veto = m.veto - (v_n - 1), map = null, updated_at = now() where no = p_no;

    when 'reset' then
      if p_role = 'station' then
        return cs2.err('forbidden', jsonb_build_object('reason', 'chief_only'));
      end if;
      update cs2.matches
         set veto = '[]'::jsonb, map = null, veto_first = null, veto_coin = false, updated_at = now()
       where no = p_no;

    else
      return cs2.validation(jsonb_build_array(cs2.verr('action', 'invalid')));
  end case;

  perform cs2.bump_version();
  perform cs2.audit(p_actor, 'veto_' || p_action, null, p_no,
                    jsonb_build_object('map', v_map, 'side', v_side, 'step', v_n, 'role', p_role));
  return jsonb_build_object('ok', true, 'match', (select cs2.match_json(x, 'full') from cs2.matches x where x.no = p_no));
end $$;

-- ---------------------------------------------------------------- json: veto fields in every match (public too)
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
      'veto_first', m.veto_first, 'veto_coin', m.veto_coin, 'veto', m.veto, 'map', m.map)
  else
    jsonb_build_object(
      'no', m.no, 'day', m.day, 'stage', m.stage, 'code', m.code, 'grp', m.grp, 'station', m.station,
      'start', m.start_at, 'end', m.end_at, 'src_a', m.src_a, 'src_b', m.src_b, 'status', m.status,
      'score_a', m.score_a, 'score_b', m.score_b, 'ot', m.ot, 'forfeit', m.forfeit,
      'team_a', m.team_a, 'team_b', m.team_b, 'reported_at', m.reported_at, 'reported_by', m.reported_by,
      'veto_first', m.veto_first, 'veto_coin', m.veto_coin, 'veto', m.veto, 'map', m.map)
  end
  from (select m.status in ('reported', 'final') and m.reported_at is not null
               and m.reported_at <= now() - interval '120 seconds' as vis) as v
$$;

-- settings.map_pool in the public state (the portal follows the database pool)
create or replace function cs2.state_json(p_admin boolean) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  s cs2.settings;
  v jsonb;
begin
  select * into s from cs2.settings where id = 1;
  v := jsonb_build_object(
    'ok', true,
    'version', case when p_admin then s.version else cs2.public_version() end,
    'now', now(),
    'settings', jsonb_build_object(
        'reg_closes_at', s.reg_closes_at, 'consent_deadline_at', s.consent_deadline_at,
        'roster_freeze_at', s.roster_freeze_at, 'registration_open', s.registration_open, 'stream_url', s.stream_url,
        'map_pool', to_jsonb(s.map_pool))
      || case when p_admin then jsonb_build_object('tokens_valid_until', s.tokens_valid_until,
                                                   'setup_used_at', s.setup_used_at)
              else '{}'::jsonb end,
    'announcements', cs2.announcements_json(p_admin),
    'teams', cs2.teams_json(p_admin),
    'draw', cs2.draw_json(p_admin),
    'matches', cs2.matches_json(p_admin),
    'decisions', cs2.decisions_json(p_admin));
  if p_admin then
    v := v || jsonb_build_object(
      'referees', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', r.id, 'label', r.label, 'station', r.station, 'active', r.active,
                      'valid_from', r.valid_from, 'valid_until', r.valid_until, 'created_at', r.created_at)
                      order by r.id), '[]'::jsonb)
                     from cs2.referee_access r),
      'audit', (select coalesce(jsonb_agg(x.j order by x.id desc), '[]'::jsonb)
                  from (select l.id, jsonb_build_object('id', l.id, 'at', l.at, 'actor', l.actor, 'action', l.action,
                                                        'team_id', l.team_id, 'match_no', l.match_no, 'detail', l.detail) as j
                          from cs2.audit_log l order by l.id desc limit 50) as x));
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------- referee API
create or replace function cs2_api.ref_veto(p_token text, p_no integer, p_action text, p_map text default null,
                                            p_step integer default null, p_side text default null)
returns jsonb
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
  return cs2.veto_apply(p_no, p_action, p_map, p_step, p_side, 'ref:' || r.label,
                        case when r.station is null then 'chief' else 'station' end);
exception when others then
  raise log 'cs2_api.ref_veto: % %', sqlstate, sqlerrm;
  return cs2.err('server', jsonb_build_object('sqlstate', sqlstate));
end $$;

-- ---------------------------------------------------------------- admin: match_veto {no, action, map?, step?, side?}
create or replace function cs2.adm_match_veto(p_actor text, p_args jsonb) returns jsonb
language plpgsql volatile set search_path = ''
as $$
begin
  return cs2.veto_apply(cs2.jint(p_args -> 'no'), p_args ->> 'action', p_args ->> 'map', cs2.jint(p_args -> 'step'),
                        p_args ->> 'side', p_actor, 'admin');
end $$;

create or replace function cs2_api.admin(p_session text, p_action text, p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer
set search_path = '' set timezone = 'Asia/Ulaanbaatar'
as $$
declare
  v_hash  text := cs2.token_hash(p_session);
  v_admin cs2.admins;
  v_args  jsonb := case when jsonb_typeof(p_args) = 'object' then p_args else '{}'::jsonb end;
  v_actor text;
begin
  select ad.* into v_admin
    from cs2.admin_sessions s
    join cs2.admins ad on ad.id = s.admin_id
   where s.token_sha256 = v_hash and s.expires_at > now();
  if v_admin.id is null then
    return cs2.err('bad_session');
  end if;
  v_actor := 'admin:' || v_admin.label;
  case coalesce(p_action, '')
    when 'overview'          then return cs2.state_json(true);
    when 'team_save'         then return cs2.adm_team_save(v_actor, v_args);
    when 'team_unconfirm'    then return cs2.adm_team_unconfirm(v_actor, v_args);
    when 'confirm_on_behalf' then return cs2.adm_confirm_on_behalf(v_actor, v_args);
    when 'consent_set'       then return cs2.adm_consent_set(v_actor, v_args);
    when 'lock'              then return cs2.adm_lock(v_actor, v_args);
    when 'unlock_until'      then return cs2.adm_unlock_until(v_actor, v_args);
    when 'settings_set'      then return cs2.adm_settings_set(v_actor, v_args);
    when 'announce'          then return cs2.adm_announce(v_actor, v_args);
    when 'announce_hide'     then return cs2.adm_announce_hide(v_actor, v_args);
    when 'tokens_issue'      then return cs2.adm_tokens_issue(v_actor, v_args);
    when 'pin_reset'         then return cs2.adm_pin_reset(v_actor, v_args);
    when 'referee_revoke'    then return cs2.adm_referee_revoke(v_actor, v_args);
    when 'export'            then return cs2.adm_export(v_actor, v_args);
    when 'draw_commit'       then return cs2.adm_draw_commit(v_actor, v_args);
    when 'draw_compute'      then return cs2.adm_draw_compute(v_actor, v_args);
    when 'draw_publish'      then return cs2.adm_draw_publish(v_actor, v_args);
    when 'draw_void'         then return cs2.adm_draw_void(v_actor, v_args);
    when 'draw_manual'       then return cs2.adm_draw_manual(v_actor, v_args);
    when 'match_result'      then return cs2.adm_match_result(v_actor, v_args);
    when 'match_update'      then return cs2.adm_match_update(v_actor, v_args);
    when 'match_veto'        then return cs2.adm_match_veto(v_actor, v_args);
    when 'group_lot'         then return cs2.adm_group_lot(v_actor, v_args);
    when 'group_approve'     then return cs2.adm_group_approve(v_actor, v_args);
    when 'purge'             then return cs2.adm_purge(v_actor, v_args, v_hash);
    when 'sessions_revoke'   then return cs2.adm_sessions_revoke(v_actor, v_args, v_hash);
    else return cs2.err('not_found', jsonb_build_object('action', left(p_action, 40)));
  end case;
exception when others then
  raise log 'cs2_api.admin(%): % %', left(p_action, 40), sqlstate, sqlerrm;
  return cs2.err('server', jsonb_build_object('sqlstate', sqlstate));
end $$;

-- ---------------------------------------------------------------- public wrapper
create or replace function public.cs2_ref_veto(p_token text, p_no integer, p_action text, p_map text default null,
                                               p_step integer default null, p_side text default null)
returns jsonb
language sql volatile security invoker set search_path = ''
as $$ select cs2_api.ref_veto(p_token, p_no, p_action, p_map, p_step, p_side) $$;

comment on function public.cs2_ref_veto(text, integer, text, text, integer, text)
  is 'Сургуулийн аварга – CS2 2026: referee map veto (first / ban / undo / reset).';

-- ---------------------------------------------------------------- grants
revoke all on function cs2_api.ref_veto(text, integer, text, text, integer, text) from public;
grant execute on function cs2_api.ref_veto(text, integer, text, text, integer, text) to anon, authenticated;
revoke all on function public.cs2_ref_veto(text, integer, text, text, integer, text) from public;
grant execute on function public.cs2_ref_veto(text, integer, text, text, integer, text) to anon, authenticated;

revoke all on all functions in schema cs2 from public, anon, authenticated;
