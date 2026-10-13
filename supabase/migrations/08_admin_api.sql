-- cs2_08_admin_api — organiser API, CONTRACT §4 (setup / login / logout / admin actions).
-- Every mutating action bumps settings.version and writes cs2.audit_log (never player names).
-- The 'purge' and 'sessions_revoke' actions are defined in cs2_09_admin_purge (applied right after this one).
-- Also redefines three helpers of cs2_04/cs2_07:
--   cs2.valid_score  — exact mirror of docs/js/logic.js validScore (unknown stage -> false even with a forfeit);
--   cs2.match_set    — a group result needs the published draw (seats), else {ok:false,error:'draw_state'};
--                      forfeit '' / 'false' = none (as validScore); scores above 999 -> invalid_score (smallint-safe);
--   cs2.roster_parse — more than 12 cards -> {slot:null, field:'players', code:'too_many'} (bounded work per call).
-- And replaces the stream_url check of cs2_02: its regex '{1,300}' is invalid in Postgres (repetition count
-- max 255), so ANY non-null stream_url raised 2201B. Same rule, valid form: https://, no whitespace, <= 308 chars.

alter table cs2.settings drop constraint if exists settings_stream_url_check;
alter table cs2.settings add constraint settings_stream_url_check
  check (stream_url is null or (stream_url ~ '^https://[^[:space:]]+$' and char_length(stream_url) <= 308));

-- ---------------------------------------------------------------- roster validation (CONTRACT §4)
-- Returns {errors:[{slot,field,code}], players:[normalised]}. Empty cards are skipped.
-- codes: required | too_long | too_short | invalid | duplicate | taken | multiple | too_many
create or replace function cs2.roster_parse(p_team_id integer, p_players jsonb) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  c_letter constant text := 'A-Za-zÀ-ÖØ-öø-ÿЀ-ӿ';
  v_errs  jsonb := '[]'::jsonb;
  v_out   jsonb := '[]'::jsonb;
  v_item  jsonb;
  v_slot  integer;
  v_first text;
  v_init  text;
  v_nick  text;
  v_sid   text;
  v_cap   boolean;
  v_age   boolean;
  v_slots integer[] := '{}';
  v_nicks text[] := '{}';
  v_sids  text[] := '{}';
  v_caps  integer := 0;
begin
  if p_players is null or jsonb_typeof(p_players) <> 'array' then
    return jsonb_build_object('errors', jsonb_build_array(cs2.verr('players', 'invalid')), 'players', '[]'::jsonb);
  end if;
  if jsonb_array_length(p_players) > 12 then
    return jsonb_build_object('errors', jsonb_build_array(cs2.verr('players', 'too_many')), 'players', '[]'::jsonb);
  end if;
  for v_item in select e.x from jsonb_array_elements(p_players) as e(x) loop
    if jsonb_typeof(v_item) <> 'object' then
      v_errs := v_errs || jsonb_build_array(cs2.verr('players', 'invalid'));
      continue;
    end if;
    v_first := cs2.norm_text(v_item ->> 'first_name');
    v_init  := cs2.norm_text(rtrim(btrim(coalesce(v_item ->> 'surname_initial', '')), '.'));
    v_nick  := nullif(btrim(coalesce(v_item ->> 'steam_nickname', '')), '');
    v_sid   := nullif(btrim(coalesce(v_item ->> 'steam_id64', '')), '');
    if v_first is null and v_init is null and v_nick is null and v_sid is null then
      continue;                                   -- empty card = no player in that slot
    end if;

    v_slot := cs2.jint(v_item -> 'slot');
    if v_slot is null or v_slot not between 1 and 6 then
      v_errs := v_errs || jsonb_build_array(cs2.verr('slot', 'invalid'));
      continue;
    end if;
    if v_slot = any(v_slots) then
      v_errs := v_errs || jsonb_build_array(cs2.verr('slot', 'duplicate', v_slot));
      continue;
    end if;
    v_slots := v_slots || v_slot;

    if v_first is null then
      v_errs := v_errs || jsonb_build_array(cs2.verr('first_name', 'required', v_slot));
    elsif char_length(v_first) > 30 then
      v_errs := v_errs || jsonb_build_array(cs2.verr('first_name', 'too_long', v_slot));
    elsif v_first !~ ('^[' || c_letter || '][' || c_letter || ' -]*$') then
      v_errs := v_errs || jsonb_build_array(cs2.verr('first_name', 'invalid', v_slot));
    end if;

    if v_init is null then
      v_errs := v_errs || jsonb_build_array(cs2.verr('surname_initial', 'required', v_slot));
    elsif char_length(v_init) <> 1 or v_init !~ ('^[' || c_letter || ']$') then
      v_errs := v_errs || jsonb_build_array(cs2.verr('surname_initial', 'invalid', v_slot));
    end if;

    if v_nick is null then
      v_errs := v_errs || jsonb_build_array(cs2.verr('steam_nickname', 'required', v_slot));
    elsif char_length(v_nick) < 2 then
      v_errs := v_errs || jsonb_build_array(cs2.verr('steam_nickname', 'too_short', v_slot));
    elsif char_length(v_nick) > 32 then
      v_errs := v_errs || jsonb_build_array(cs2.verr('steam_nickname', 'too_long', v_slot));
    elsif v_nick ~ '[[:cntrl:]]' then
      v_errs := v_errs || jsonb_build_array(cs2.verr('steam_nickname', 'invalid', v_slot));
    elsif lower(v_nick) = any(v_nicks) then
      v_errs := v_errs || jsonb_build_array(cs2.verr('steam_nickname', 'duplicate', v_slot));
    elsif exists (select 1 from cs2.players p
                   where lower(p.steam_nickname) = lower(v_nick) and p.team_id <> p_team_id) then
      v_errs := v_errs || jsonb_build_array(cs2.verr('steam_nickname', 'taken', v_slot));   -- other team not revealed
    end if;
    if v_nick is not null then
      v_nicks := v_nicks || lower(v_nick);
    end if;

    if v_sid is not null then
      if v_sid !~ '^7656119[0-9]{10}$' then
        v_errs := v_errs || jsonb_build_array(cs2.verr('steam_id64', 'invalid', v_slot));
      elsif v_sid = any(v_sids) then
        v_errs := v_errs || jsonb_build_array(cs2.verr('steam_id64', 'duplicate', v_slot));
      elsif exists (select 1 from cs2.players p where p.steam_id64 = v_sid and p.team_id <> p_team_id) then
        v_errs := v_errs || jsonb_build_array(cs2.verr('steam_id64', 'taken', v_slot));
      end if;
      v_sids := v_sids || v_sid;
    end if;

    v_cap := coalesce(cs2.jbool(v_item -> 'is_captain'), false);
    v_age := coalesce(cs2.jbool(v_item -> 'age13'), false);
    if v_cap then
      v_caps := v_caps + 1;
      if v_caps > 1 then
        v_errs := v_errs || jsonb_build_array(cs2.verr('is_captain', 'multiple', v_slot));
      end if;
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'slot', v_slot, 'first_name', v_first, 'surname_initial', upper(v_init),
      'steam_nickname', v_nick, 'steam_id64', v_sid, 'is_captain', v_cap, 'age13', v_age));
  end loop;
  return jsonb_build_object('errors', v_errs, 'players', v_out);
end $$;

-- ---------------------------------------------------------------- scores (mirror of logic.js validScore)
-- stage group|qf|sf|final|third; forfeit 'a'|'b' = the side that LOST by forfeit -> only 0:13 / 13:0 is legal;
-- group: 13:0..11 either way or 12:12; knockout: 13:0..11 either way or OT W = 16+3k (k >= 0), W-4 <= L <= W-2.
create or replace function cs2.valid_score(p_stage text, p_a integer, p_b integer, p_forfeit text) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(case
    when p_stage is null or p_stage not in ('group', 'qf', 'sf', 'final', 'third') then false
    when nullif(p_forfeit, '') is not null then
      (p_forfeit = 'a' and p_a = 0 and p_b = 13) or (p_forfeit = 'b' and p_a = 13 and p_b = 0)
    when p_a is null or p_b is null or p_a < 0 or p_b < 0 then false
    when greatest(p_a, p_b) = 13 and least(p_a, p_b) <= 11 then true
    when p_stage = 'group' then p_a = 12 and p_b = 12
    else greatest(p_a, p_b) >= 16 and (greatest(p_a, p_b) - 16) % 3 = 0
         and least(p_a, p_b) between greatest(p_a, p_b) - 4 and greatest(p_a, p_b) - 2
  end, false)
$$;

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

-- ---------------------------------------------------------------- roster & team actions
-- team_save {team_id, players, expected_version?} — bypasses the window; the confirmation is kept only
-- while the roster still meets the confirm requirements (else it is cleared: unconfirmed = true)
create or replace function cs2.adm_team_save(p_actor text, p_args jsonb) returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  v_team   integer := cs2.jint(p_args -> 'team_id');
  a        cs2.team_access;
  v_parsed jsonb;
  v_err    jsonb;
  v_ver    integer;
  v_unconf boolean;
  v_at     timestamptz;
begin
  select * into a from cs2.team_access where team_id = v_team for update;
  if a.team_id is null then
    return cs2.err('not_found');
  end if;
  if coalesce(jsonb_typeof(p_args -> 'expected_version'), 'null') <> 'null'
     and cs2.jint(p_args -> 'expected_version') is distinct from a.version then
    return cs2.err('version_conflict', jsonb_build_object('version', a.version));
  end if;
  v_parsed := cs2.roster_parse(v_team, p_args -> 'players');
  if jsonb_array_length(v_parsed -> 'errors') > 0 then
    return cs2.validation(v_parsed -> 'errors');
  end if;
  v_err := cs2.roster_write(v_team, v_parsed -> 'players');
  if v_err is not null then
    return v_err;
  end if;
  v_unconf := a.confirmed_at is not null and jsonb_array_length(cs2.confirm_errors(v_team, null, false)) > 0;
  update cs2.team_access
     set version = version + 1, updated_at = now(),
         confirmed_at   = case when v_unconf then null else confirmed_at end,
         confirmed_by   = case when v_unconf then null else confirmed_by end,
         confirm_attest = case when v_unconf then null else confirm_attest end,
         confirm_reason = case when v_unconf then null else confirm_reason end
   where team_id = v_team
  returning version, confirmed_at into v_ver, v_at;
  perform cs2.bump_version();
  perform cs2.audit(p_actor, 'team_save', v_team, null,
                    jsonb_build_object('players', jsonb_array_length(v_parsed -> 'players'), 'unconfirmed', v_unconf));
  return jsonb_build_object('ok', true, 'team_id', v_team, 'version', v_ver, 'confirmed_at', v_at,
                            'unconfirmed', v_unconf,
                            'players', cs2.players_json(v_team, true), 'checks', cs2.roster_checks(v_team));
end $$;

-- team_unconfirm {team_id}
create or replace function cs2.adm_team_unconfirm(p_actor text, p_args jsonb) returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  v_team integer := cs2.jint(p_args -> 'team_id');
  v_ver  integer;
begin
  update cs2.team_access
     set confirmed_at = null, confirmed_by = null, confirm_attest = null, confirm_reason = null,
         version = version + 1, updated_at = now()
   where team_id = v_team
  returning version into v_ver;
  if v_ver is null then
    return cs2.err('not_found');
  end if;
  perform cs2.bump_version();
  perform cs2.audit(p_actor, 'team_unconfirm', v_team, null, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'team_id', v_team, 'version', v_ver);
end $$;

-- confirm_on_behalf {team_id, reason} — roster requirements still apply (attestations replaced by the reason)
create or replace function cs2.adm_confirm_on_behalf(p_actor text, p_args jsonb) returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  v_team   integer := cs2.jint(p_args -> 'team_id');
  v_reason text := left(cs2.norm_text(p_args ->> 'reason'), 300);
  a        cs2.team_access;
  v_errs   jsonb;
  v_at     timestamptz;
  v_ver    integer;
begin
  if v_reason is null then
    return cs2.validation(jsonb_build_array(cs2.verr('reason', 'required')));
  end if;
  select * into a from cs2.team_access where team_id = v_team for update;
  if a.team_id is null then
    return cs2.err('not_found');
  end if;
  v_errs := cs2.confirm_errors(v_team, null, false);
  if jsonb_array_length(v_errs) > 0 then
    return cs2.validation(v_errs);
  end if;
  update cs2.team_access
     set confirmed_at = now(), confirmed_by = left(p_actor, 80), confirm_reason = v_reason, confirm_attest = null,
         version = version + 1, updated_at = now()
   where team_id = v_team
  returning confirmed_at, version into v_at, v_ver;
  perform cs2.bump_version();
  perform cs2.audit(p_actor, 'confirm_on_behalf', v_team, null, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'team_id', v_team, 'confirmed_at', v_at, 'version', v_ver);
end $$;

-- consent_set {player_id, consent_paper?, consent_3a?, consent_3b?, consent_3v?, alias?}
create or replace function cs2.adm_consent_set(p_actor text, p_args jsonb) returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  v_id     bigint := cs2.jint(p_args -> 'player_id');
  p        cs2.players;
  v_errs   jsonb := '[]'::jsonb;
  v_key    text;
  v_alias  text;
  v_fields jsonb;
begin
  select * into p from cs2.players where id = v_id for update;
  if p.id is null then
    return cs2.err('not_found');
  end if;
  foreach v_key in array array['consent_paper', 'consent_3a', 'consent_3b', 'consent_3v'] loop
    if p_args ? v_key and jsonb_typeof(p_args -> v_key) <> 'null' and cs2.jbool(p_args -> v_key) is null then
      v_errs := v_errs || jsonb_build_array(cs2.verr(v_key, 'invalid', p.slot));
    end if;
  end loop;
  if p_args ? 'alias' then
    v_alias := cs2.norm_text(p_args ->> 'alias');
    if v_alias is not null and (char_length(v_alias) > 32 or v_alias ~ '[[:cntrl:]]') then
      v_errs := v_errs || jsonb_build_array(cs2.verr('alias', 'invalid', p.slot));
    end if;
  end if;
  if jsonb_array_length(v_errs) > 0 then
    return cs2.validation(v_errs);
  end if;
  update cs2.players
     set consent_paper = case when p_args ? 'consent_paper' then coalesce(cs2.jbool(p_args -> 'consent_paper'), false)
                              else consent_paper end,
         consent_3a = case when p_args ? 'consent_3a' then cs2.jbool(p_args -> 'consent_3a') else consent_3a end,
         consent_3b = case when p_args ? 'consent_3b' then cs2.jbool(p_args -> 'consent_3b') else consent_3b end,
         consent_3v = case when p_args ? 'consent_3v' then cs2.jbool(p_args -> 'consent_3v') else consent_3v end,
         alias = case when p_args ? 'alias' then v_alias else alias end,
         updated_at = now()
   where id = v_id;
  -- the roster version is NOT bumped: ticks do not conflict with a class editing its roster
  -- (cs2.roster_write keeps ticks/alias with the same person)
  select coalesce(jsonb_agg(k.k), '[]'::jsonb) into v_fields
    from unnest(array['consent_paper', 'consent_3a', 'consent_3b', 'consent_3v', 'alias']) as k(k)
   where p_args ? k.k;
  perform cs2.bump_version();
  perform cs2.audit(p_actor, 'consent_set', p.team_id, null,
                    jsonb_build_object('player_id', p.id, 'slot', p.slot, 'fields', v_fields));
  return jsonb_build_object('ok', true, 'player',
           (select x.j from jsonb_array_elements(cs2.players_json(p.team_id, true)) as x(j)
             where (x.j ->> 'id')::bigint = p.id));
end $$;

-- lock {team_id, locked}
create or replace function cs2.adm_lock(p_actor text, p_args jsonb) returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  v_team   integer := cs2.jint(p_args -> 'team_id');
  v_locked boolean := cs2.jbool(p_args -> 'locked');
begin
  if v_locked is null then
    return cs2.validation(jsonb_build_array(cs2.verr('locked', 'required')));
  end if;
  update cs2.team_access set locked = v_locked, updated_at = now() where team_id = v_team;
  if not found then
    return cs2.err('not_found');
  end if;
  perform cs2.bump_version();
  perform cs2.audit(p_actor, 'lock', v_team, null, jsonb_build_object('locked', v_locked));
  return jsonb_build_object('ok', true, 'team_id', v_team, 'locked', v_locked);
end $$;

-- unlock_until {team_id, until|null} — lets one class edit after the general deadline
create or replace function cs2.adm_unlock_until(p_actor text, p_args jsonb) returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  v_team  integer := cs2.jint(p_args -> 'team_id');
  v_until timestamptz := cs2.jts(p_args -> 'until');
begin
  if coalesce(jsonb_typeof(p_args -> 'until'), 'null') <> 'null' and v_until is null then
    return cs2.validation(jsonb_build_array(cs2.verr('until', 'invalid')));
  end if;
  update cs2.team_access set unlocked_until = v_until, updated_at = now() where team_id = v_team;
  if not found then
    return cs2.err('not_found');
  end if;
  perform cs2.bump_version();
  perform cs2.audit(p_actor, 'unlock_until', v_team, null, jsonb_build_object('until', v_until));
  return jsonb_build_object('ok', true, 'team_id', v_team, 'unlocked_until', v_until);
end $$;

-- settings_set {registration_open?, stream_url?, reg_closes_at?, consent_deadline_at?, roster_freeze_at?, tokens_valid_until?}
create or replace function cs2.adm_settings_set(p_actor text, p_args jsonb) returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  v_errs   jsonb := '[]'::jsonb;
  v_open   boolean;
  v_url    text;
  v_key    text;
  v_fields jsonb;
  s        cs2.settings;
begin
  if p_args ? 'registration_open' then
    v_open := cs2.jbool(p_args -> 'registration_open');
    if v_open is null then
      v_errs := v_errs || jsonb_build_array(cs2.verr('registration_open', 'invalid'));
    end if;
  end if;
  if p_args ? 'stream_url' then
    v_url := nullif(btrim(coalesce(p_args ->> 'stream_url', '')), '');
    if v_url is not null and (v_url !~ '^https://[^[:space:]]+$' or char_length(v_url) > 308) then
      v_errs := v_errs || jsonb_build_array(cs2.verr('stream_url', 'invalid'));
    end if;
  end if;
  foreach v_key in array array['reg_closes_at', 'consent_deadline_at', 'roster_freeze_at', 'tokens_valid_until'] loop
    if p_args ? v_key and cs2.jts(p_args -> v_key) is null then
      v_errs := v_errs || jsonb_build_array(cs2.verr(v_key, 'invalid'));
    end if;
  end loop;
  if jsonb_array_length(v_errs) > 0 then
    return cs2.validation(v_errs);
  end if;
  update cs2.settings
     set registration_open = case when p_args ? 'registration_open' then v_open else registration_open end,
         stream_url = case when p_args ? 'stream_url' then v_url else stream_url end,
         reg_closes_at = coalesce(cs2.jts(p_args -> 'reg_closes_at'), reg_closes_at),
         consent_deadline_at = coalesce(cs2.jts(p_args -> 'consent_deadline_at'), consent_deadline_at),
         roster_freeze_at = coalesce(cs2.jts(p_args -> 'roster_freeze_at'), roster_freeze_at),
         tokens_valid_until = coalesce(cs2.jts(p_args -> 'tokens_valid_until'), tokens_valid_until),
         version = version + 1, updated_at = now()
   where id = 1
  returning * into s;
  select coalesce(jsonb_agg(k.k), '[]'::jsonb) into v_fields
    from jsonb_object_keys(p_args) as k(k)
   where k.k in ('registration_open', 'stream_url', 'reg_closes_at', 'consent_deadline_at', 'roster_freeze_at',
                 'tokens_valid_until');
  perform cs2.audit(p_actor, 'settings_set', null, null, jsonb_build_object('fields', v_fields));
  return jsonb_build_object('ok', true, 'settings', jsonb_build_object(
    'reg_closes_at', s.reg_closes_at, 'consent_deadline_at', s.consent_deadline_at,
    'roster_freeze_at', s.roster_freeze_at, 'tokens_valid_until', s.tokens_valid_until,
    'registration_open', s.registration_open, 'stream_url', s.stream_url));
end $$;

-- announce {text, level:'info'|'warn'}
create or replace function cs2.adm_announce(p_actor text, p_args jsonb) returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  v_text  text := cs2.norm_text(p_args ->> 'text');
  v_level text := coalesce(nullif(p_args ->> 'level', ''), 'info');
  v_id    bigint;
begin
  if v_text is null or char_length(v_text) > 500 then
    return cs2.validation(jsonb_build_array(cs2.verr('text', case when v_text is null then 'required' else 'too_long' end)));
  end if;
  if v_level not in ('info', 'warn') then
    return cs2.validation(jsonb_build_array(cs2.verr('level', 'invalid')));
  end if;
  insert into cs2.announcements (text, level, created_by) values (v_text, v_level, left(p_actor, 80))
  returning id into v_id;
  perform cs2.bump_version();
  perform cs2.audit(p_actor, 'announce', null, null, jsonb_build_object('id', v_id, 'level', v_level));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- announce_hide {id}
create or replace function cs2.adm_announce_hide(p_actor text, p_args jsonb) returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  v_id bigint := cs2.jint(p_args -> 'id');
begin
  update cs2.announcements set hidden_at = now() where id = v_id and hidden_at is null;
  if not found then
    return cs2.err('not_found');
  end if;
  perform cs2.bump_version();
  perform cs2.audit(p_actor, 'announce_hide', null, null, jsonb_build_object('id', v_id));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ---------------------------------------------------------------- tokens & PINs (plaintext returned ONCE)
create or replace function cs2.issue_class_access(p_team integer) returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  v_tok text := cs2.new_token();
  v_pin text := cs2.new_pin();
begin
  update cs2.team_access
     set token_sha256 = cs2.sha256_hex(v_tok), token_issued_at = now(),
         pin_bcrypt = extensions.crypt(v_pin, extensions.gen_salt('bf', 8)), pin_issued_at = now(),
         pin_fails = 0, pin_fail_times = '{}', pin_fails_total = 0, pin_locked_until = null, pin_hard_locked = false,
         updated_at = now()
   where team_id = p_team;
  return (select jsonb_build_object('team_id', t.id, 'code', t.code, 'name', t.name, 'token', v_tok, 'pin', v_pin)
            from cs2.teams t where t.id = p_team);
end $$;

-- tokens_issue {kind:'class', team_id} | {kind:'class_all'} | {kind:'referee', station:'A'|'B'|null, label}
create or replace function cs2.adm_tokens_issue(p_actor text, p_args jsonb) returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  v_kind    text := p_args ->> 'kind';
  v_team    integer;
  v_items   jsonb := '[]'::jsonb;
  v_station text;
  v_label   text;
  v_tok     text;
  v_id      bigint;
  v_res     jsonb;
begin
  if v_kind = 'class' then
    v_team := cs2.jint(p_args -> 'team_id');
    if not exists (select 1 from cs2.teams t where t.id = v_team) then
      return cs2.err('not_found');
    end if;
    v_res := cs2.issue_class_access(v_team);
    perform cs2.bump_version();
    perform cs2.audit(p_actor, 'tokens_issue', v_team, null, jsonb_build_object('kind', 'class'));
    return jsonb_build_object('ok', true) || v_res;
  elsif v_kind = 'class_all' then
    for v_team in select t.id from cs2.teams t where not t.is_hidden order by t.id loop
      v_items := v_items || jsonb_build_array(cs2.issue_class_access(v_team));
    end loop;
    perform cs2.bump_version();
    perform cs2.audit(p_actor, 'tokens_issue', null, null,
                      jsonb_build_object('kind', 'class_all', 'count', jsonb_array_length(v_items)));
    return jsonb_build_object('ok', true, 'items', v_items);
  elsif v_kind = 'referee' then
    v_station := nullif(btrim(coalesce(p_args ->> 'station', '')), '');
    if v_station is not null and v_station not in ('A', 'B') then
      return cs2.validation(jsonb_build_array(cs2.verr('station', 'invalid')));
    end if;
    v_label := coalesce(left(cs2.norm_text(p_args ->> 'label'), 60),
                        case v_station when 'A' then 'А станцын шүүгч' when 'B' then 'Б станцын шүүгч'
                                       else 'Ерөнхий шүүгч' end);
    v_tok := cs2.new_token();
    insert into cs2.referee_access (label, station, token_sha256)
    values (v_label, v_station, cs2.sha256_hex(v_tok))
    returning id into v_id;
    perform cs2.bump_version();
    perform cs2.audit(p_actor, 'tokens_issue', null, null,
                      jsonb_build_object('kind', 'referee', 'station', v_station, 'referee_id', v_id));
    return jsonb_build_object('ok', true, 'id', v_id, 'label', v_label, 'station', v_station, 'token', v_tok);
  end if;
  return cs2.validation(jsonb_build_array(cs2.verr('kind', 'invalid')));
end $$;

-- pin_reset {team_id} -> {pin}; clears the lockout counters
create or replace function cs2.adm_pin_reset(p_actor text, p_args jsonb) returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  v_team integer := cs2.jint(p_args -> 'team_id');
  v_pin  text := cs2.new_pin();
begin
  update cs2.team_access
     set pin_bcrypt = extensions.crypt(v_pin, extensions.gen_salt('bf', 8)), pin_issued_at = now(),
         pin_fails = 0, pin_fail_times = '{}', pin_fails_total = 0, pin_locked_until = null, pin_hard_locked = false,
         updated_at = now()
   where team_id = v_team;
  if not found then
    return cs2.err('not_found');
  end if;
  perform cs2.bump_version();
  perform cs2.audit(p_actor, 'pin_reset', v_team, null, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'team_id', v_team, 'pin', v_pin);
end $$;

-- referee_revoke {id} (extra) — deactivates a referee link
create or replace function cs2.adm_referee_revoke(p_actor text, p_args jsonb) returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  v_id bigint := cs2.jint(p_args -> 'id');
begin
  update cs2.referee_access set active = false where id = v_id and active;
  if not found then
    return cs2.err('not_found');
  end if;
  perform cs2.bump_version();
  perform cs2.audit(p_actor, 'referee_revoke', null, null, jsonb_build_object('referee_id', v_id));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ---------------------------------------------------------------- exports (CSV-ready; hidden test team excluded)
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
                 case when p.consent_3b is true then p.steam_nickname
                      else coalesce(p.alias, t.name || '-Тоглогч' || p.slot) end)
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
    -- display = steam_nickname only with online consent (row 3б = true), otherwise alias
    v_res := jsonb_build_object(
      'teams', coalesce((
        select jsonb_object_agg(t.code, jsonb_build_object('name', t.name, 'players', coalesce((
                 select jsonb_object_agg(p.steam_id64,
                          case when p.consent_3b is true then p.steam_nickname
                               else coalesce(p.alias, t.name || '-Тоглогч' || p.slot) end)
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

-- ---------------------------------------------------------------- matches & groups
-- match_result {no, score_a, score_b, forfeit, ot, team_a, team_b, status:'reported'|'final'} (ot is derived)
create or replace function cs2.adm_match_result(p_actor text, p_args jsonb) returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  v_status  text := coalesce(nullif(p_args ->> 'status', ''), 'reported');
  v_forfeit text := case when jsonb_typeof(p_args -> 'forfeit') = 'string' then p_args ->> 'forfeit' end;  -- null/false = none
begin
  if v_status not in ('reported', 'final') then
    return cs2.validation(jsonb_build_array(cs2.verr('status', 'invalid')));
  end if;
  return cs2.match_set(cs2.jint(p_args -> 'no'), v_status, cs2.jint(p_args -> 'score_a'), cs2.jint(p_args -> 'score_b'),
                       v_forfeit, cs2.jint(p_args -> 'team_a'), cs2.jint(p_args -> 'team_b'),
                       p_actor, 'admin');
end $$;

-- match_update {no, start?, station?, status?} — moving 'start' keeps the slot length
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
  if v_status in ('reported', 'final') and not cs2.valid_score(m.stage, m.score_a, m.score_b, m.forfeit) then
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

-- group_lot {grp, order:[teamIds]|null, reason}
create or replace function cs2.adm_group_lot(p_actor text, p_args jsonb) returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  v_grp    text := p_args ->> 'grp';
  v_reason text := left(cs2.norm_text(p_args ->> 'reason'), 300);
  v_order  integer[];
begin
  if v_grp is null or v_grp not in ('A', 'B', 'V', 'G') then
    return cs2.validation(jsonb_build_array(cs2.verr('grp', 'invalid')));
  end if;
  if coalesce(jsonb_typeof(p_args -> 'order'), 'null') = 'null' then
    update cs2.group_decisions set lot = null, lot_reason = null, lot_at = null, updated_at = now() where grp = v_grp;
  else
    if jsonb_typeof(p_args -> 'order') <> 'array' then
      return cs2.validation(jsonb_build_array(cs2.verr('order', 'invalid')));
    end if;
    v_order := array(select cs2.jint(e.x) from jsonb_array_elements(p_args -> 'order') with ordinality as e(x, i)
                      order by e.i);
    if cardinality(v_order) not between 2 and 3
       or array_position(v_order, null) is not null
       or (select count(distinct u.v) from unnest(v_order) as u(v)) <> cardinality(v_order)
       or exists (select 1 from unnest(v_order) as u(v)
                   where not exists (select 1 from cs2.teams t where t.id = u.v and t.grp = v_grp)) then
      return cs2.validation(jsonb_build_array(cs2.verr('order', 'invalid')));
    end if;
    if v_reason is null then
      return cs2.validation(jsonb_build_array(cs2.verr('reason', 'required')));
    end if;
    update cs2.group_decisions set lot = v_order, lot_reason = v_reason, lot_at = now(), updated_at = now()
     where grp = v_grp;
  end if;
  perform cs2.bump_version();
  perform cs2.audit(p_actor, 'group_lot', null, null, jsonb_build_object('grp', v_grp, 'order', to_jsonb(v_order)));
  return jsonb_build_object('ok', true, 'grp', v_grp, 'lot', to_jsonb(v_order));
end $$;

-- group_approve {grp, approved}
create or replace function cs2.adm_group_approve(p_actor text, p_args jsonb) returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  v_grp text := p_args ->> 'grp';
  v_ok  boolean := cs2.jbool(p_args -> 'approved');
begin
  if v_grp is null or v_grp not in ('A', 'B', 'V', 'G') then
    return cs2.validation(jsonb_build_array(cs2.verr('grp', 'invalid')));
  end if;
  if v_ok is null then
    return cs2.validation(jsonb_build_array(cs2.verr('approved', 'required')));
  end if;
  update cs2.group_decisions
     set approved = v_ok, approved_at = case when v_ok then now() end, updated_at = now()
   where grp = v_grp;
  perform cs2.bump_version();
  perform cs2.audit(p_actor, 'group_approve', null, null, jsonb_build_object('grp', v_grp, 'approved', v_ok));
  return jsonb_build_object('ok', true, 'grp', v_grp, 'approved', v_ok);
end $$;

-- ---------------------------------------------------------------- API: setup / login / logout / dispatcher
-- one-time: sha256(code) = settings.setup_code_hash and setup_used_at null; creates the first organiser
-- (no session: the UI logs in with cs2_admin_login right after). 5 wrong codes / 10 min -> throttled.
create or replace function cs2_api.admin_setup(p_code text, p_label text, p_secret text) returns jsonb
language plpgsql volatile security definer
set search_path = '' set timezone = 'Asia/Ulaanbaatar'
as $$
declare
  s       cs2.settings;
  v_until timestamptz;
  v_label text := cs2.norm_text(p_label);
  v_errs  jsonb := '[]'::jsonb;
  v_id    bigint;
begin
  v_until := cs2.throttle_until('setup');
  if v_until is not null then
    return cs2.err('throttled', jsonb_build_object('until', v_until));
  end if;
  select * into s from cs2.settings where id = 1 for update;
  if p_code is null
     or (cs2.sha256_hex(p_code) <> s.setup_code_hash and cs2.sha256_hex(btrim(p_code)) <> s.setup_code_hash) then
    v_until := cs2.throttle_fail('setup', 5, interval '10 minutes');
    perform cs2.audit('anon', 'admin_setup_fail', null, null, jsonb_build_object('throttled', v_until is not null));
    return cs2.err('bad_code');
  end if;
  if s.setup_used_at is not null then
    return cs2.err('already_setup');
  end if;
  if v_label is null then
    v_errs := v_errs || jsonb_build_array(cs2.verr('label', 'required'));
  elsif char_length(v_label) > 60 then
    v_errs := v_errs || jsonb_build_array(cs2.verr('label', 'too_long'));
  elsif exists (select 1 from cs2.admins ad where lower(ad.label) = lower(v_label)) then
    v_errs := v_errs || jsonb_build_array(cs2.verr('label', 'taken'));
  end if;
  if p_secret is null or char_length(p_secret) < 10 then
    v_errs := v_errs || jsonb_build_array(cs2.verr('secret', 'too_short'));
  elsif char_length(p_secret) > 200 then
    v_errs := v_errs || jsonb_build_array(cs2.verr('secret', 'too_long'));
  end if;
  if jsonb_array_length(v_errs) > 0 then
    return cs2.validation(v_errs);
  end if;
  insert into cs2.admins (label, secret_bcrypt)
  values (v_label, extensions.crypt(p_secret, extensions.gen_salt('bf', 8)))
  returning id into v_id;
  update cs2.settings set setup_used_at = now(), updated_at = now() where id = 1;
  perform cs2.throttle_reset('setup');
  perform cs2.bump_version();
  perform cs2.audit('admin:' || v_label, 'admin_setup', null, null, jsonb_build_object('admin_id', v_id));
  return jsonb_build_object('ok', true, 'label', v_label);
exception when others then
  raise log 'cs2_api.admin_setup: % %', sqlstate, sqlerrm;
  return cs2.err('server', jsonb_build_object('sqlstate', sqlstate));
end $$;

-- 5 failures / 10 min per label -> throttled
create or replace function cs2_api.admin_login(p_label text, p_secret text) returns jsonb
language plpgsql volatile security definer
set search_path = '' set timezone = 'Asia/Ulaanbaatar'
as $$
declare
  v_label text := cs2.norm_text(p_label);
  v_key   text := left('login:' || lower(coalesce(cs2.norm_text(p_label), '')), 100);
  v_until timestamptz;
  v_admin cs2.admins;
  v_ok    boolean := false;
  v_tok   text;
  v_exp   timestamptz;
begin
  v_until := cs2.throttle_until(v_key);
  if v_until is not null then
    return cs2.err('throttled', jsonb_build_object('until', v_until));
  end if;
  select * into v_admin from cs2.admins a where lower(a.label) = lower(v_label);
  if v_admin.id is null then
    perform extensions.crypt(coalesce(p_secret, ''), extensions.gen_salt('bf', 8));   -- similar timing
  else
    v_ok := p_secret is not null and extensions.crypt(p_secret, v_admin.secret_bcrypt) = v_admin.secret_bcrypt;
  end if;
  if not v_ok then
    v_until := cs2.throttle_fail(v_key, 5, interval '10 minutes');
    if v_admin.id is not null then
      perform cs2.audit('anon', 'admin_login_fail', null, null,
                        jsonb_build_object('admin_id', v_admin.id, 'throttled', v_until is not null));
    end if;
    return cs2.err('bad_credentials');
  end if;
  perform cs2.throttle_reset(v_key);
  delete from cs2.admin_sessions where expires_at < now();
  v_tok := cs2.new_token();
  v_exp := now() + interval '12 hours';
  insert into cs2.admin_sessions (token_sha256, admin_id, expires_at) values (cs2.sha256_hex(v_tok), v_admin.id, v_exp);
  update cs2.admins set last_login_at = now() where id = v_admin.id;
  perform cs2.audit('admin:' || v_admin.label, 'login', null, null, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'session', v_tok, 'expires_at', v_exp, 'label', v_admin.label);
exception when others then
  raise log 'cs2_api.admin_login: % %', sqlstate, sqlerrm;
  return cs2.err('server', jsonb_build_object('sqlstate', sqlstate));
end $$;

create or replace function cs2_api.admin_logout(p_session text) returns jsonb
language plpgsql volatile security definer
set search_path = '' set timezone = 'Asia/Ulaanbaatar'
as $$
declare
  v_admin_id bigint;
begin
  delete from cs2.admin_sessions where token_sha256 = cs2.token_hash(p_session)
  returning admin_id into v_admin_id;
  if v_admin_id is not null then
    perform cs2.audit('admin:' || (select a.label from cs2.admins a where a.id = v_admin_id), 'logout', null, null,
                      '{}'::jsonb);
  end if;
  return jsonb_build_object('ok', true);
exception when others then
  raise log 'cs2_api.admin_logout: % %', sqlstate, sqlerrm;
  return cs2.err('server', jsonb_build_object('sqlstate', sqlstate));
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

-- ---------------------------------------------------------------- public wrappers
create or replace function public.cs2_admin_setup(p_code text, p_label text, p_secret text) returns jsonb
language sql volatile security invoker set search_path = ''
as $$ select cs2_api.admin_setup(p_code, p_label, p_secret) $$;

create or replace function public.cs2_admin_login(p_label text, p_secret text) returns jsonb
language sql volatile security invoker set search_path = ''
as $$ select cs2_api.admin_login(p_label, p_secret) $$;

create or replace function public.cs2_admin_logout(p_session text) returns jsonb
language sql volatile security invoker set search_path = ''
as $$ select cs2_api.admin_logout(p_session) $$;

create or replace function public.cs2_admin(p_session text, p_action text, p_args jsonb default '{}'::jsonb) returns jsonb
language sql volatile security invoker set search_path = ''
as $$ select cs2_api.admin(p_session, p_action, p_args) $$;

comment on function public.cs2_admin_setup(text, text, text) is 'Ангийн аварга – CS2 2026: one-time organiser setup.';
comment on function public.cs2_admin_login(text, text) is 'Ангийн аварга – CS2 2026: organiser login (12 h session).';
comment on function public.cs2_admin_logout(text) is 'Ангийн аварга – CS2 2026: organiser logout.';
comment on function public.cs2_admin(text, text, jsonb) is 'Ангийн аварга – CS2 2026: organiser actions.';

-- ---------------------------------------------------------------- grants
revoke all on function cs2_api.admin_setup(text, text, text) from public;
revoke all on function cs2_api.admin_login(text, text) from public;
revoke all on function cs2_api.admin_logout(text) from public;
revoke all on function cs2_api.admin(text, text, jsonb) from public;
grant execute on function cs2_api.admin_setup(text, text, text), cs2_api.admin_login(text, text),
                          cs2_api.admin_logout(text), cs2_api.admin(text, text, jsonb)
  to anon, authenticated;

revoke all on function public.cs2_admin_setup(text, text, text) from public;
revoke all on function public.cs2_admin_login(text, text) from public;
revoke all on function public.cs2_admin_logout(text) from public;
revoke all on function public.cs2_admin(text, text, jsonb) from public;
grant execute on function public.cs2_admin_setup(text, text, text), public.cs2_admin_login(text, text),
                          public.cs2_admin_logout(text), public.cs2_admin(text, text, jsonb)
  to anon, authenticated;

revoke all on all functions in schema cs2 from public, anon, authenticated;
