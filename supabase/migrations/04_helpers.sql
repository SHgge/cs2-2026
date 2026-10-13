-- cs2_04_helpers — internal helpers in schema cs2 (never executable by anon/authenticated).
-- Every function: search_path = '' and fully qualified names (pg_catalog is always searched first).

-- ---------------------------------------------------------------- crypto / tokens
create or replace function cs2.sha256_hex(p text) returns text
language sql immutable strict parallel safe set search_path = ''
as $$ select encode(extensions.digest(convert_to(p, 'UTF8'), 'sha256'), 'hex') $$;

-- 16 random bytes -> base64url (22 chars). Only sha256 of it is ever stored.
create or replace function cs2.new_token() returns text
language sql volatile set search_path = ''
as $$ select translate(rtrim(encode(extensions.gen_random_bytes(16), 'base64'), '='), '+/', '-_') $$;

-- sha256 of a token from a URL, or null if it cannot be a token.
create or replace function cs2.token_hash(p text) returns text
language sql immutable set search_path = ''
as $$ select case when p ~ '^[A-Za-z0-9_-]{16,128}$' then cs2.sha256_hex(p) end $$;

-- 4-digit PIN, uniform, never 0000/1111…/1234/4321-style runs.
create or replace function cs2.new_pin() returns text
language plpgsql volatile set search_path = ''
as $$
declare
  v_b bytea;
  v_n integer;
  v_pin text;
begin
  loop
    v_b := extensions.gen_random_bytes(2);
    v_n := get_byte(v_b, 0) * 256 + get_byte(v_b, 1);
    continue when v_n >= 60000;                                         -- rejection sampling
    v_pin := lpad((v_n % 10000)::text, 4, '0');
    continue when v_pin = repeat(left(v_pin, 1), 4);                    -- 0000, 1111, …
    continue when strpos('0123456789', v_pin) > 0 or strpos('9876543210', v_pin) > 0;  -- 1234, 4321, …
    return v_pin;
  end loop;
end $$;

-- ---------------------------------------------------------------- small json helpers
create or replace function cs2.err(p_code text, p_extra jsonb default '{}'::jsonb) returns jsonb
language sql immutable set search_path = ''
as $$ select jsonb_build_object('ok', false, 'error', p_code) || coalesce(p_extra, '{}'::jsonb) $$;

create or replace function cs2.verr(p_field text, p_code text, p_slot integer default null) returns jsonb
language sql immutable set search_path = ''
as $$ select jsonb_build_object('slot', p_slot, 'field', p_field, 'code', p_code) $$;

create or replace function cs2.validation(p_errors jsonb) returns jsonb
language sql immutable set search_path = ''
as $$ select cs2.err('validation', jsonb_build_object('errors', coalesce(p_errors, '[]'::jsonb))) $$;

create or replace function cs2.jint(p jsonb) returns integer
language sql immutable set search_path = ''
as $$
  select case when jsonb_typeof(p) in ('number', 'string') and (p #>> '{}') ~ '^-?[0-9]{1,9}$'
              then (p #>> '{}')::integer end
$$;

create or replace function cs2.jbool(p jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select case jsonb_typeof(p)
           when 'boolean' then (p #>> '{}')::boolean
           when 'string' then case lower(p #>> '{}') when 'true' then true when 'false' then false end
           when 'number' then (p #>> '{}') <> '0'
         end
$$;

-- timestamptz from a json string, null if absent or unparsable
create or replace function cs2.jts(p jsonb) returns timestamptz
language plpgsql stable set search_path = ''
as $$
begin
  if p is null or jsonb_typeof(p) <> 'string' then
    return null;
  end if;
  return (p #>> '{}')::timestamptz;
exception when others then
  return null;
end $$;

-- trim + collapse inner whitespace; '' -> null
create or replace function cs2.norm_text(p text) returns text
language sql immutable set search_path = ''
as $$ select nullif(btrim(regexp_replace(coalesce(p, ''), '[[:space:]]+', ' ', 'g')), '') $$;

-- local (Asia/Ulaanbaatar) 'YYYY-MM-DD HH24:MI' for CSV exports
create or replace function cs2.ts_local(p timestamptz) returns text
language sql stable set search_path = ''
as $$ select coalesce(to_char(p at time zone 'Asia/Ulaanbaatar', 'YYYY-MM-DD HH24:MI'), '') $$;

create or replace function cs2.yes_no(p boolean) returns text
language sql immutable set search_path = ''
as $$ select case p when true then 'Тийм' when false then 'Үгүй' else '' end $$;

-- ---------------------------------------------------------------- version, audit, throttle
create or replace function cs2.bump_version() returns bigint
language sql volatile set search_path = ''
as $$ update cs2.settings set version = version + 1, updated_at = now() where id = 1 returning version $$;

-- detail must never contain player names
create or replace function cs2.audit(p_actor text, p_action text, p_team_id integer default null,
                                     p_match_no integer default null, p_detail jsonb default '{}'::jsonb)
returns void
language sql volatile set search_path = ''
as $$
  insert into cs2.audit_log (actor, action, team_id, match_no, detail)
  values (left(coalesce(p_actor, '?'), 80), left(coalesce(p_action, '?'), 60), p_team_id, p_match_no,
          coalesce(p_detail, '{}'::jsonb))
$$;

create or replace function cs2.throttle_until(p_key text) returns timestamptz
language sql stable set search_path = ''
as $$ select t.until from cs2.throttle t where t.key = p_key and t.until > now() $$;

-- register one failure; returns the lock end if this failure reached p_max inside p_window
create or replace function cs2.throttle_fail(p_key text, p_max integer, p_window interval) returns timestamptz
language plpgsql volatile set search_path = ''
as $$
declare
  v_fails integer;
  v_until timestamptz;
begin
  delete from cs2.throttle
   where window_start < now() - interval '1 day' and (until is null or until < now()) and key <> p_key;
  insert into cs2.throttle as t (key, fails, window_start, until)
  values (p_key, 1, now(), null)
  on conflict (key) do update
     set fails        = case when t.window_start <= now() - p_window then 1 else t.fails + 1 end,
         window_start = case when t.window_start <= now() - p_window then now() else t.window_start end
  returning t.fails into v_fails;
  if v_fails >= p_max then
    v_until := now() + p_window;
    update cs2.throttle set until = v_until, fails = 0, window_start = now() where key = p_key;
    return v_until;
  end if;
  return null;
end $$;

create or replace function cs2.throttle_reset(p_key text) returns void
language sql volatile set search_path = ''
as $$ delete from cs2.throttle where key = p_key $$;

-- ---------------------------------------------------------------- scores (mirror of logic.validScore)
-- group: 13:0..11 either way or 12:12; knockout: 13:0..11 either way or OT W=16+3k with L in [W-4, W-2];
-- forfeit = side that LOST by forfeit ('a'|'b') => 13:0 for the other side.
create or replace function cs2.valid_score(p_stage text, p_a integer, p_b integer, p_forfeit text) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(case
    when p_a is null or p_b is null or p_a < 0 or p_b < 0 then false
    when p_forfeit is not null then
      (p_forfeit = 'a' and p_a = 0 and p_b = 13) or (p_forfeit = 'b' and p_a = 13 and p_b = 0)
    when p_stage = 'group' then
      (p_a = 13 and p_b <= 11) or (p_b = 13 and p_a <= 11) or (p_a = 12 and p_b = 12)
    when p_stage in ('qf', 'sf', 'final', 'third') then
      (p_a = 13 and p_b <= 11) or (p_b = 13 and p_a <= 11)
      or (greatest(p_a, p_b) >= 16 and (greatest(p_a, p_b) - 16) % 3 = 0
          and least(p_a, p_b) between greatest(p_a, p_b) - 4 and greatest(p_a, p_b) - 2)
    else false
  end, false)
$$;

-- ---------------------------------------------------------------- roster validation (CONTRACT §4)
-- Returns {errors:[{slot,field,code}], players:[normalised]}. Empty cards are skipped.
-- codes: required | too_long | too_short | invalid | duplicate | taken | multiple
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

-- Readiness of the stored roster (shown on the class page): starters 1-5, one captain, all 13+.
create or replace function cs2.roster_checks(p_team_id integer) returns jsonb
language sql stable set search_path = ''
as $$
  with p as (select * from cs2.players where team_id = p_team_id),
  e as (
    select s.s as slot, 'slot'::text as field, 'missing'::text as code, s.s as ord
      from generate_series(1, 5) as s(s)
     where not exists (select 1 from p where p.slot = s.s)
    union all
    select null, 'is_captain', 'missing', 10 where (select count(*) from p where p.is_captain) <> 1
    union all
    select p.slot, 'age13', 'required', 20 + p.slot from p where not p.age13
  )
  select jsonb_build_object(
    'complete', not exists (select 1 from e),
    'errors', coalesce((select jsonb_agg(jsonb_build_object('slot', e.slot, 'field', e.field, 'code', e.code) order by e.ord)
                          from e), '[]'::jsonb))
$$;

-- Requirements for confirmation: 5-6 players (slots 1-5 filled), exactly 1 captain, all age13, 4 attestations.
create or replace function cs2.confirm_errors(p_team_id integer, p_attest jsonb, p_check_attest boolean) returns jsonb
language sql stable set search_path = ''
as $$
  with p as (select * from cs2.players where team_id = p_team_id),
  e as (
    select null::integer as slot, 'players'::text as field, 'count'::text as code, 0 as ord
     where (select count(*) from p) not between 5 and 6
    union all
    select s.s, 'slot', 'missing', s.s from generate_series(1, 5) as s(s)
     where not exists (select 1 from p where p.slot = s.s)
    union all
    select null, 'is_captain', 'missing', 10 where (select count(*) from p where p.is_captain) <> 1
    union all
    select p.slot, 'age13', 'required', 20 + p.slot from p where not p.age13
    union all
    select null, 'attest.' || u.k, 'required', 30 + u.i::integer
      from unnest(array['enrolled', 'age13', 'own_steam', 'rules']) with ordinality as u(k, i)
     where p_check_attest and coalesce(p_attest ->> u.k, '') <> 'true'
  )
  select coalesce(jsonb_agg(jsonb_build_object('slot', e.slot, 'field', e.field, 'code', e.code) order by e.ord), '[]'::jsonb)
  from e
$$;

-- Replace a team's roster. Consent ticks/alias follow the same person (same first name + initial),
-- preferring the same slot; ids are kept for matched people. Returns null or an error object.
create or replace function cs2.roster_write(p_team_id integer, p_players jsonb) returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  v_rows jsonb;
  v_con  text;
begin
  with newp as (
    select (e.x ->> 'slot')::smallint as slot, e.x as data,
           lower(e.x ->> 'first_name') || '|' || upper(e.x ->> 'surname_initial') as pkey
      from jsonb_array_elements(coalesce(p_players, '[]'::jsonb)) as e(x)
  ), oldp as (
    select p.id, p.slot, p.consent_paper, p.consent_3a, p.consent_3b, p.consent_3v, p.alias, p.created_at,
           lower(p.first_name) || '|' || upper(p.surname_initial) as pkey
      from cs2.players p where p.team_id = p_team_id
  ), p1 as (
    select n.slot, o.id from newp n join oldp o on o.slot = n.slot and o.pkey = n.pkey
  ), rn as (
    select n.slot, n.pkey, row_number() over (partition by n.pkey order by n.slot) as r
      from newp n where not exists (select 1 from p1 where p1.slot = n.slot)
  ), ro as (
    select o.id, o.pkey, row_number() over (partition by o.pkey order by o.slot) as r
      from oldp o where not exists (select 1 from p1 where p1.id = o.id)
  ), pairs as (
    select p1.slot, p1.id from p1
    union all
    select rn.slot, ro.id from rn join ro on ro.pkey = rn.pkey and ro.r = rn.r
  )
  select coalesce(jsonb_agg(n.data || jsonb_build_object(
           'id', o.id, 'consent_paper', coalesce(o.consent_paper, false),
           'consent_3a', o.consent_3a, 'consent_3b', o.consent_3b, 'consent_3v', o.consent_3v,
           'alias', o.alias, 'created_at', o.created_at) order by n.slot), '[]'::jsonb)
    into v_rows
    from newp n
    left join pairs pr on pr.slot = n.slot
    left join oldp o on o.id = pr.id;

  begin
    delete from cs2.players where team_id = p_team_id;
    insert into cs2.players (id, team_id, slot, first_name, surname_initial, steam_nickname, steam_id64,
                             is_captain, age13, consent_paper, consent_3a, consent_3b, consent_3v, alias,
                             created_at, updated_at)
    select (e.r ->> 'id')::bigint, p_team_id, (e.r ->> 'slot')::smallint, e.r ->> 'first_name',
           e.r ->> 'surname_initial', e.r ->> 'steam_nickname', e.r ->> 'steam_id64',
           (e.r ->> 'is_captain')::boolean, (e.r ->> 'age13')::boolean, (e.r ->> 'consent_paper')::boolean,
           (e.r ->> 'consent_3a')::boolean, (e.r ->> 'consent_3b')::boolean, (e.r ->> 'consent_3v')::boolean,
           e.r ->> 'alias', (e.r ->> 'created_at')::timestamptz, now()
      from jsonb_array_elements(v_rows) as e(r)
     where e.r ->> 'id' is not null;
    insert into cs2.players (team_id, slot, first_name, surname_initial, steam_nickname, steam_id64, is_captain, age13)
    select p_team_id, (e.r ->> 'slot')::smallint, e.r ->> 'first_name', e.r ->> 'surname_initial',
           e.r ->> 'steam_nickname', e.r ->> 'steam_id64', (e.r ->> 'is_captain')::boolean, (e.r ->> 'age13')::boolean
      from jsonb_array_elements(v_rows) as e(r)
     where e.r ->> 'id' is null;
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    return cs2.validation(jsonb_build_array(cs2.verr(
             case when v_con = 'players_steam_id64_uq' then 'steam_id64' else 'steam_nickname' end, 'taken')));
  end;
  return null;
end $$;

-- ---------------------------------------------------------------- class window & PIN
-- reason: open | confirmed (editable, PIN needed) | closed | frozen | locked
create or replace function cs2.class_window(p_team_id integer) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  s cs2.settings;
  a cs2.team_access;
  v_reason text;
  v_edit   boolean;
  v_closes timestamptz;
begin
  select * into s from cs2.settings where id = 1;
  select * into a from cs2.team_access where team_id = p_team_id;
  if a.locked then
    v_reason := 'locked'; v_edit := false; v_closes := null;
  elsif a.unlocked_until is not null and a.unlocked_until > now() then
    v_edit := true; v_closes := a.unlocked_until;
    v_reason := case when a.confirmed_at is not null then 'confirmed' else 'open' end;
  elsif now() >= s.roster_freeze_at then
    v_reason := 'frozen'; v_edit := false; v_closes := s.roster_freeze_at;
  elsif now() >= s.reg_closes_at or not s.registration_open then
    v_reason := 'closed'; v_edit := false; v_closes := s.reg_closes_at;
  else
    v_edit := true; v_closes := s.reg_closes_at;
    v_reason := case when a.confirmed_at is not null then 'confirmed' else 'open' end;
  end if;
  return jsonb_build_object('editable', v_edit, 'needs_pin', v_edit and a.confirmed_at is not null,
                            'reason', v_reason, 'closes_at', v_closes);
end $$;

-- error object for a non-editable window
create or replace function cs2.window_error(p_window jsonb) returns jsonb
language sql immutable set search_path = ''
as $$
  select cs2.err(case when p_window ->> 'reason' = 'locked' then 'locked' else 'closed' end,
                 jsonb_build_object('reason', p_window ->> 'reason', 'closes_at', p_window -> 'closes_at'))
$$;

-- Teacher PIN check with lockout: 5 wrong within 15 min -> locked 15 min; 10 wrong in total -> locked
-- until admin pin_reset. Counters are persisted (callers return the error, they never RAISE).
-- Returns null when the PIN is right, else an error object.
create or replace function cs2.pin_attempt(p_team_id integer, p_pin text) returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  a        cs2.team_access;
  v_pin    text := btrim(coalesce(p_pin, ''));
  v_recent timestamptz[];
  v_total  integer;
  v_until  timestamptz;
begin
  select * into a from cs2.team_access where team_id = p_team_id for update;
  if a.team_id is null then
    return cs2.err('bad_token');
  end if;
  if a.pin_hard_locked then
    return cs2.err('pin_locked', jsonb_build_object('until', null, 'hard', true));
  end if;
  if a.pin_locked_until is not null and a.pin_locked_until > now() then
    return cs2.err('pin_locked', jsonb_build_object('until', a.pin_locked_until, 'hard', false));
  end if;
  if v_pin = '' then
    return cs2.err('pin_required');
  end if;
  if a.pin_bcrypt is null then
    return cs2.err('forbidden', jsonb_build_object('reason', 'no_pin'));
  end if;
  v_recent := array(select u.t from unnest(a.pin_fail_times) as u(t)
                     where u.t > now() - interval '15 minutes' order by u.t);
  if v_pin ~ '^[0-9]{4}$' and extensions.crypt(v_pin, a.pin_bcrypt) = a.pin_bcrypt then
    update cs2.team_access set pin_fails = 0, pin_fail_times = '{}', pin_locked_until = null, updated_at = now()
     where team_id = p_team_id;
    return null;
  end if;
  if v_pin !~ '^[0-9]{4}$' then                     -- malformed input can never be right: not counted
    return cs2.err('pin_wrong', jsonb_build_object('attempts_left',
             greatest(0, least(5 - cardinality(v_recent), 10 - a.pin_fails_total))));
  end if;
  v_recent := v_recent || now();
  v_total := a.pin_fails_total + 1;
  if v_total >= 10 then
    update cs2.team_access
       set pin_hard_locked = true, pin_fails_total = v_total, pin_fails = 0, pin_fail_times = '{}',
           pin_locked_until = null, updated_at = now()
     where team_id = p_team_id;
    return cs2.err('pin_locked', jsonb_build_object('until', null, 'hard', true));
  end if;
  if cardinality(v_recent) >= 5 then
    v_until := now() + interval '15 minutes';
    update cs2.team_access
       set pin_locked_until = v_until, pin_fails_total = v_total, pin_fails = 0, pin_fail_times = '{}',
           updated_at = now()
     where team_id = p_team_id;
    return cs2.err('pin_locked', jsonb_build_object('until', v_until, 'hard', false));
  end if;
  update cs2.team_access
     set pin_fails = cardinality(v_recent), pin_fail_times = v_recent, pin_fails_total = v_total, updated_at = now()
   where team_id = p_team_id;
  return cs2.err('pin_wrong', jsonb_build_object('attempts_left', least(5 - cardinality(v_recent), 10 - v_total)));
end $$;

create or replace function cs2.team_by_token(p_token text) returns integer
language sql stable set search_path = ''
as $$ select a.team_id from cs2.team_access a where a.token_sha256 = cs2.token_hash(p_token) $$;

create or replace function cs2.tokens_expired() returns boolean
language sql stable set search_path = ''
as $$ select now() > s.tokens_valid_until from cs2.settings s where s.id = 1 $$;

-- ---------------------------------------------------------------- json builders
create or replace function cs2.players_json(p_team_id integer, p_full boolean default false) returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(jsonb_agg(
           jsonb_build_object('slot', p.slot, 'first_name', p.first_name, 'surname_initial', p.surname_initial,
                              'steam_nickname', p.steam_nickname, 'steam_id64', p.steam_id64,
                              'is_captain', p.is_captain, 'age13', p.age13, 'consent_paper', p.consent_paper)
           || case when p_full then jsonb_build_object('id', p.id, 'consent_3a', p.consent_3a, 'consent_3b', p.consent_3b,
                                                       'consent_3v', p.consent_3v, 'alias', p.alias)
                   else '{}'::jsonb end
           order by p.slot), '[]'::jsonb)
  from cs2.players p where p.team_id = p_team_id
$$;

-- shape of cs2_class_get
create or replace function cs2.class_state(p_team_id integer) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'ok', true,
    'team', jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name, 'is_teachers', t.is_teachers),
    'now', now(),
    'window', cs2.class_window(t.id),
    'version', a.version,
    'confirmed_at', a.confirmed_at,
    'players', cs2.players_json(t.id, false),
    'checks', cs2.roster_checks(t.id),
    'deadlines', jsonb_build_object('reg_closes_at', s.reg_closes_at, 'consent_deadline_at', s.consent_deadline_at,
                                    'roster_freeze_at', s.roster_freeze_at, 'tokens_valid_until', s.tokens_valid_until))
  from cs2.teams t
  join cs2.team_access a on a.team_id = t.id
  cross join cs2.settings s
  where t.id = p_team_id and s.id = 1
$$;

-- one match; p_mode 'public' applies the 120-second spoiler hold, anything else = full/unfiltered
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
      'team_a', m.team_a, 'team_b', m.team_b)
  else
    jsonb_build_object(
      'no', m.no, 'day', m.day, 'stage', m.stage, 'code', m.code, 'grp', m.grp, 'station', m.station,
      'start', m.start_at, 'end', m.end_at, 'src_a', m.src_a, 'src_b', m.src_b, 'status', m.status,
      'score_a', m.score_a, 'score_b', m.score_b, 'ot', m.ot, 'forfeit', m.forfeit,
      'team_a', m.team_a, 'team_b', m.team_b, 'reported_at', m.reported_at, 'reported_by', m.reported_by)
  end
  from (select m.status in ('reported', 'final') and m.reported_at is not null
               and m.reported_at <= now() - interval '120 seconds' as vis) as v
$$;

create or replace function cs2.matches_json(p_admin boolean) returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(jsonb_agg(cs2.match_json(m, case when p_admin then 'full' else 'public' end) order by m.no), '[]'::jsonb)
  from cs2.matches m
$$;

-- Public version = settings.version*100 + number of results already past the 120-s hold,
-- so that polling clients (p_version short-circuit) also notice when a hold expires.
create or replace function cs2.public_version() returns bigint
language sql stable set search_path = ''
as $$
  select s.version * 100
         + (select count(*) from cs2.matches m
             where m.status in ('reported', 'final') and m.reported_at <= now() - interval '120 seconds')
  from cs2.settings s where s.id = 1
$$;

create or replace function cs2.draw_json(p_admin boolean) returns jsonb
language sql stable set search_path = ''
as $$
  with d as (
    select * from cs2.draws where status <> 'void' order by id desc limit 1
  ), h as (
    select x.status, x.reason, x.at, dd.id
      from cs2.draws dd
     cross join lateral (values ('committed', null::text, dd.committed_at),
                                ('computed', null::text, dd.computed_at),
                                ('published', case when dd.method = 'manual' then dd.reason end, dd.published_at),
                                ('void', dd.void_reason, dd.voided_at)) as x(status, reason, at)
     where x.at is not null
  )
  select jsonb_build_object(
    'status', coalesce((select d.status from d), 'none'),
    'method', (select d.method from d),
    'commit', (select d.commit_hash from d),
    'secret', (select d.secret from d where d.status in ('computed', 'published')),
    'inputs', (select d.inputs from d where d.status in ('computed', 'published')),
    'seed', (select d.seed from d where d.status in ('computed', 'published')),
    'groups', (select d.groups from d where d.status in ('computed', 'published')),
    'history', coalesce((select jsonb_agg(jsonb_build_object('status', h.status, 'reason', h.reason, 'at', h.at)
                                          order by h.at, h.id) from h), '[]'::jsonb))
  || case when p_admin then jsonb_build_object(
       'id', (select d.id from d),
       'inputs_str', (select d.inputs_str from d),
       'keys', (select d.keys from d))
     else '{}'::jsonb end
$$;

create or replace function cs2.teams_json(p_admin boolean) returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', t.id, 'code', t.code, 'name', t.name, 'pot', t.pot, 'is_teachers', t.is_teachers,
      'reg', jsonb_build_object('players', coalesce(pc.n, 0), 'confirmed', a.confirmed_at is not null,
                                'consents', coalesce(pc.c, 0)))
    || case when p_admin then jsonb_build_object(
         'is_hidden', t.is_hidden, 'grp', t.grp, 'seat', t.seat,
         'players', cs2.players_json(t.id, true), 'checks', cs2.roster_checks(t.id),
         'confirmed_at', a.confirmed_at, 'confirmed_by', a.confirmed_by, 'confirm_reason', a.confirm_reason,
         'locked', a.locked, 'unlocked_until', a.unlocked_until,
         'pin_locked_until', case when a.pin_locked_until > now() then a.pin_locked_until end,
         'pin_hard_locked', a.pin_hard_locked, 'pin_fails_total', a.pin_fails_total,
         'version', a.version, 'has_token', a.token_sha256 is not null,
         'token_issued_at', a.token_issued_at, 'has_pin', a.pin_bcrypt is not null, 'pin_issued_at', a.pin_issued_at)
       else '{}'::jsonb end
    order by t.id), '[]'::jsonb)
  from cs2.teams t
  join cs2.team_access a on a.team_id = t.id
  left join (select p.team_id, count(*) as n, count(*) filter (where p.consent_paper) as c
               from cs2.players p group by p.team_id) as pc on pc.team_id = t.id
  where p_admin or not t.is_hidden
$$;

create or replace function cs2.announcements_json(p_admin boolean) returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object('id', n.id, 'text', n.text, 'level', n.level, 'at', n.created_at)
    || case when p_admin then jsonb_build_object('hidden_at', n.hidden_at) else '{}'::jsonb end
    order by n.created_at desc, n.id desc), '[]'::jsonb)
  from cs2.announcements n
  where p_admin or n.hidden_at is null
$$;

create or replace function cs2.decisions_json(p_admin boolean) returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(jsonb_object_agg(d.grp,
    jsonb_build_object('lot', to_jsonb(d.lot), 'approved', d.approved)
    || case when p_admin then jsonb_build_object('lot_reason', d.lot_reason, 'lot_at', d.lot_at, 'approved_at', d.approved_at)
            else '{}'::jsonb end), '{}'::jsonb)
  from cs2.group_decisions d
$$;

-- public state (p_admin=false) or admin overview (p_admin=true, unfiltered + private extras)
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
        'roster_freeze_at', s.roster_freeze_at, 'registration_open', s.registration_open, 'stream_url', s.stream_url)
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

revoke all on all functions in schema cs2 from public, anon, authenticated;
