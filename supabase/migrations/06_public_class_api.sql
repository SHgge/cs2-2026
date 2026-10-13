-- cs2_06_public_class_api — public state + class (homeroom) API, CONTRACT §4.
-- SECURITY DEFINER in cs2_api (owner postgres), thin SECURITY INVOKER wrappers public.cs2_*.
-- Errors are returned as {ok:false,error,…} (HTTP 200), never raised, so PIN counters persist.

create or replace function cs2_api.public_state(p_version bigint default null) returns jsonb
language plpgsql stable security definer
set search_path = '' set timezone = 'Asia/Ulaanbaatar'
as $$
declare
  v_version bigint;
begin
  v_version := cs2.public_version();
  if p_version is not null and p_version = v_version then
    return jsonb_build_object('ok', true, 'version', v_version, 'unchanged', true);
  end if;
  return cs2.state_json(false);
exception when others then
  raise log 'cs2_api.public_state: % %', sqlstate, sqlerrm;
  return cs2.err('server', jsonb_build_object('sqlstate', sqlstate));
end $$;

create or replace function cs2_api.class_get(p_token text) returns jsonb
language plpgsql stable security definer
set search_path = '' set timezone = 'Asia/Ulaanbaatar'
as $$
declare
  v_team integer;
begin
  v_team := cs2.team_by_token(p_token);
  if v_team is null then
    return cs2.err('bad_token');
  end if;
  if cs2.tokens_expired() then
    return cs2.err('expired');
  end if;
  return cs2.class_state(v_team);
exception when others then
  raise log 'cs2_api.class_get: % %', sqlstate, sqlerrm;
  return cs2.err('server', jsonb_build_object('sqlstate', sqlstate));
end $$;

-- payload {expected_version, pin?, players:[{slot, first_name, surname_initial, steam_nickname, steam_id64?, is_captain, age13}]}
create or replace function cs2_api.class_save(p_token text, p_payload jsonb) returns jsonb
language plpgsql volatile security definer
set search_path = '' set timezone = 'Asia/Ulaanbaatar'
as $$
declare
  v_team   integer;
  a        cs2.team_access;
  v_window jsonb;
  v_exp    integer;
  v_parsed jsonb;
  v_err    jsonb;
  v_pin    boolean := false;
begin
  v_team := cs2.team_by_token(p_token);
  if v_team is null then
    return cs2.err('bad_token');
  end if;
  if cs2.tokens_expired() then
    return cs2.err('expired');
  end if;
  select * into a from cs2.team_access where team_id = v_team for update;
  v_window := cs2.class_window(v_team);
  if not (v_window ->> 'editable')::boolean then
    return cs2.window_error(v_window);
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return cs2.validation(jsonb_build_array(cs2.verr('payload', 'invalid')));
  end if;
  v_exp := cs2.jint(p_payload -> 'expected_version');
  if v_exp is null then
    return cs2.validation(jsonb_build_array(cs2.verr('expected_version', 'required')));
  end if;
  if v_exp <> a.version then
    return cs2.err('version_conflict', jsonb_build_object('version', a.version, 'state', cs2.class_state(v_team)));
  end if;
  if a.confirmed_at is not null then                 -- confirmed roster: teacher PIN required
    v_err := cs2.pin_attempt(v_team, p_payload ->> 'pin');
    if v_err is not null then
      return v_err;
    end if;
    v_pin := true;
  end if;
  v_parsed := cs2.roster_parse(v_team, p_payload -> 'players');
  if jsonb_array_length(v_parsed -> 'errors') > 0 then
    return cs2.validation(v_parsed -> 'errors');
  end if;
  v_err := cs2.roster_write(v_team, v_parsed -> 'players');
  if v_err is not null then
    return v_err;
  end if;
  update cs2.team_access                              -- a successful save clears the confirmation
     set version = version + 1, confirmed_at = null, confirmed_by = null, confirm_attest = null,
         confirm_reason = null, updated_at = now()
   where team_id = v_team;
  perform cs2.bump_version();
  perform cs2.audit('class:' || (select t.code from cs2.teams t where t.id = v_team), 'class_save', v_team, null,
                    jsonb_build_object('players', jsonb_array_length(v_parsed -> 'players'), 'pin', v_pin,
                                       'unconfirmed', a.confirmed_at is not null));
  return cs2.class_state(v_team);
exception when others then
  raise log 'cs2_api.class_save: % %', sqlstate, sqlerrm;
  return cs2.err('server', jsonb_build_object('sqlstate', sqlstate));
end $$;

-- attest {enrolled:true, age13:true, own_steam:true, rules:true}
create or replace function cs2_api.class_confirm(p_token text, p_pin text, p_attest jsonb) returns jsonb
language plpgsql volatile security definer
set search_path = '' set timezone = 'Asia/Ulaanbaatar'
as $$
declare
  v_team   integer;
  a        cs2.team_access;
  v_window jsonb;
  v_errs   jsonb;
  v_err    jsonb;
  v_at     timestamptz;
  v_ver    integer;
begin
  v_team := cs2.team_by_token(p_token);
  if v_team is null then
    return cs2.err('bad_token');
  end if;
  if cs2.tokens_expired() then
    return cs2.err('expired');
  end if;
  select * into a from cs2.team_access where team_id = v_team for update;
  v_window := cs2.class_window(v_team);
  if not (v_window ->> 'editable')::boolean then
    return cs2.window_error(v_window);
  end if;
  v_errs := cs2.confirm_errors(v_team, p_attest, true);
  if jsonb_array_length(v_errs) > 0 then
    return cs2.validation(v_errs);
  end if;
  v_err := cs2.pin_attempt(v_team, p_pin);
  if v_err is not null then
    return v_err;
  end if;
  update cs2.team_access
     set confirmed_at = now(), confirmed_by = 'teacher',
         confirm_attest = jsonb_build_object('enrolled', true, 'age13', true, 'own_steam', true, 'rules', true),
         confirm_reason = null, version = version + 1, updated_at = now()
   where team_id = v_team
  returning confirmed_at, version into v_at, v_ver;
  perform cs2.bump_version();
  perform cs2.audit('class:' || (select t.code from cs2.teams t where t.id = v_team), 'class_confirm', v_team, null,
                    jsonb_build_object('players', (select count(*) from cs2.players p where p.team_id = v_team)));
  return jsonb_build_object('ok', true, 'confirmed_at', v_at, 'version', v_ver);
exception when others then
  raise log 'cs2_api.class_confirm: % %', sqlstate, sqlerrm;
  return cs2.err('server', jsonb_build_object('sqlstate', sqlstate));
end $$;

-- ---------------------------------------------------------------- public wrappers (exact CONTRACT signatures)
create or replace function public.cs2_public_state(p_version bigint default null) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select cs2_api.public_state(p_version) $$;

create or replace function public.cs2_class_get(p_token text) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select cs2_api.class_get(p_token) $$;

create or replace function public.cs2_class_save(p_token text, p_payload jsonb) returns jsonb
language sql volatile security invoker set search_path = ''
as $$ select cs2_api.class_save(p_token, p_payload) $$;

create or replace function public.cs2_class_confirm(p_token text, p_pin text, p_attest jsonb) returns jsonb
language sql volatile security invoker set search_path = ''
as $$ select cs2_api.class_confirm(p_token, p_pin, p_attest) $$;

comment on function public.cs2_public_state(bigint) is 'Ангийн аварга – CS2 2026: public state (no player data).';
comment on function public.cs2_class_get(text) is 'Ангийн аварга – CS2 2026: class roster by secret link token.';
comment on function public.cs2_class_save(text, jsonb) is 'Ангийн аварга – CS2 2026: save class roster.';
comment on function public.cs2_class_confirm(text, text, jsonb) is 'Ангийн аварга – CS2 2026: homeroom teacher confirmation (PIN).';

-- ---------------------------------------------------------------- grants
revoke all on function cs2_api.public_state(bigint) from public;
revoke all on function cs2_api.class_get(text) from public;
revoke all on function cs2_api.class_save(text, jsonb) from public;
revoke all on function cs2_api.class_confirm(text, text, jsonb) from public;
grant execute on function cs2_api.public_state(bigint), cs2_api.class_get(text),
                          cs2_api.class_save(text, jsonb), cs2_api.class_confirm(text, text, jsonb)
  to anon, authenticated;

revoke all on function public.cs2_public_state(bigint) from public;
revoke all on function public.cs2_class_get(text) from public;
revoke all on function public.cs2_class_save(text, jsonb) from public;
revoke all on function public.cs2_class_confirm(text, text, jsonb) from public;
grant execute on function public.cs2_public_state(bigint), public.cs2_class_get(text),
                          public.cs2_class_save(text, jsonb), public.cs2_class_confirm(text, text, jsonb)
  to anon, authenticated;

revoke all on all functions in schema cs2 from public, anon, authenticated;
