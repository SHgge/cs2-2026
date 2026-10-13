-- cs2_05_draw — commit-reveal group draw (CONTRACT §3/§4) + physical-lot fallback.
-- seed = sha256("cs2draw-v1|" + lower(secret) + "|" + inputs); key[code] = sha256(seed + "|" + code);
-- inside each pot sort by key (bytewise, lowercase hex) -> position 0..3 = A, B, V, G; seat = pot.

-- The secret is stored exactly as the one that matched the commit (sha256 of the hex text).
alter table cs2.draws drop constraint draws_secret_check;
alter table cs2.draws add constraint draws_secret_check check (secret ~ '^[0-9a-fA-F]{64}$');

create or replace function cs2.draw_compute_groups(p_secret text, p_inputs jsonb) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  v_inputs text;
  v_seed   text;
  v_keys   jsonb;
  v_groups jsonb;
begin
  select string_agg(t.code || '=' || ((p_inputs ->> t.code)::integer)::text, ',' order by t.id)
    into v_inputs
    from cs2.teams t
   where not t.is_hidden;
  v_seed := cs2.sha256_hex('cs2draw-v1|' || lower(p_secret) || '|' || v_inputs);
  with k as (
    select t.id, t.code, t.pot, cs2.sha256_hex(v_seed || '|' || t.code) as hkey
      from cs2.teams t
     where not t.is_hidden
  ), r as (
    select k.id, k.code, k.pot, k.hkey,
           row_number() over (partition by k.pot order by k.hkey collate "C", k.id) as pos
      from k
  )
  select (select jsonb_object_agg(k.code, k.hkey) from k),
         (select jsonb_object_agg(g.letter, g.codes)
            from (select (array['A', 'B', 'V', 'G'])[r.pos] as letter, jsonb_agg(r.code order by r.pot) as codes
                    from r group by r.pos) as g)
    into v_keys, v_groups;
  return jsonb_build_object('inputs', v_inputs, 'seed', v_seed, 'keys', v_keys, 'groups', v_groups);
end $$;

-- Validates {A:[pot1,pot2,pot3], B:[…], V:[…], G:[…]} (codes; every team exactly once, position = pot).
create or replace function cs2.draw_groups_errors(p_groups jsonb) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  v_errs jsonb := '[]'::jsonb;
  v_g    text;
  v_i    integer;
  v_code text;
  v_pot  smallint;
  v_seen text[] := '{}';
begin
  if p_groups is null or jsonb_typeof(p_groups) <> 'object' then
    return jsonb_build_array(cs2.verr('groups', 'invalid'));
  end if;
  if exists (select 1 from jsonb_object_keys(p_groups) as k(k) where k.k not in ('A', 'B', 'V', 'G')) then
    v_errs := v_errs || jsonb_build_array(cs2.verr('groups', 'invalid'));
  end if;
  foreach v_g in array array['A', 'B', 'V', 'G'] loop
    if coalesce(jsonb_typeof(p_groups -> v_g), '') <> 'array' then
      v_errs := v_errs || jsonb_build_array(cs2.verr('groups.' || v_g, 'invalid'));
      continue;
    end if;
    if jsonb_array_length(p_groups -> v_g) <> 3 then
      v_errs := v_errs || jsonb_build_array(cs2.verr('groups.' || v_g, 'invalid'));
      continue;
    end if;
    for v_i in 0..2 loop
      v_code := p_groups -> v_g ->> v_i;
      v_pot := null;
      select t.pot into v_pot from cs2.teams t where t.code = v_code and not t.is_hidden;
      if v_pot is null then
        v_errs := v_errs || jsonb_build_array(cs2.verr('groups.' || v_g, 'unknown_team', v_i + 1));
      elsif v_pot <> v_i + 1 then
        v_errs := v_errs || jsonb_build_array(cs2.verr('groups.' || v_g, 'wrong_pot', v_i + 1));
      elsif v_code = any(v_seen) then
        v_errs := v_errs || jsonb_build_array(cs2.verr('groups.' || v_g, 'duplicate', v_i + 1));
      end if;
      if v_code is not null then
        v_seen := v_seen || v_code;
      end if;
    end loop;
  end loop;
  return v_errs;
end $$;

-- Writes teams.grp/seat and the team ids of the 12 group matches.
create or replace function cs2.draw_apply_seats(p_groups jsonb) returns void
language plpgsql volatile set search_path = ''
as $$
declare
  v_g text;
  v_i integer;
begin
  update cs2.teams set grp = null, seat = null where grp is not null;
  foreach v_g in array array['A', 'B', 'V', 'G'] loop
    for v_i in 0..2 loop
      update cs2.teams set grp = v_g, seat = v_i + 1 where code = p_groups -> v_g ->> v_i;
    end loop;
  end loop;
  update cs2.matches as m
     set team_a = ta.id, team_b = tb.id, updated_at = now()
    from cs2.teams ta, cs2.teams tb
   where m.stage = 'group'
     and ta.grp = m.grp and ta.seat = substring(m.src_a from '([1-3])$')::integer
     and tb.grp = m.grp and tb.seat = substring(m.src_b from '([1-3])$')::integer;
end $$;

create or replace function cs2.draw_clear_seats() returns void
language sql volatile set search_path = ''
as $$
  update cs2.teams set grp = null, seat = null where grp is not null;
  update cs2.matches set team_a = null, team_b = null, updated_at = now() where stage = 'group';
  update cs2.group_decisions
     set lot = null, lot_reason = null, lot_at = null, approved = false, approved_at = null, updated_at = now()
   where grp is not null;
$$;

-- ---------------------------------------------------------------- admin draw actions (called by cs2_api.admin)
-- draw_commit {commit}
create or replace function cs2.adm_draw_commit(p_actor text, p_args jsonb) returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  v_commit text := lower(btrim(coalesce(p_args ->> 'commit', '')));
  v_status text;
  v_id     bigint;
begin
  if v_commit !~ '^[0-9a-f]{64}$' then
    return cs2.validation(jsonb_build_array(cs2.verr('commit', 'invalid')));
  end if;
  perform 1 from cs2.settings where id = 1 for update;
  select d.status into v_status from cs2.draws d where d.status <> 'void';
  if v_status is not null then
    return cs2.err('draw_state', jsonb_build_object('status', v_status));
  end if;
  insert into cs2.draws (status, method, commit_hash, committed_at)
  values ('committed', 'commit', v_commit, now())
  returning id into v_id;
  perform cs2.bump_version();
  perform cs2.audit(p_actor, 'draw_commit', null, null, jsonb_build_object('draw_id', v_id, 'commit', v_commit));
  return jsonb_build_object('ok', true, 'draw', cs2.draw_json(true));
end $$;

-- draw_compute {secret, inputs:{code:n}}
create or replace function cs2.adm_draw_compute(p_actor text, p_args jsonb) returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  d        cs2.draws;
  v_raw    text := btrim(coalesce(p_args ->> 'secret', ''));
  v_secret text;
  v_errs   jsonb := '[]'::jsonb;
  v_inputs jsonb := '{}'::jsonb;
  v_code   text;
  v_txt    text;
  v_res    jsonb;
begin
  perform 1 from cs2.settings where id = 1 for update;
  select * into d from cs2.draws where status <> 'void' for update;
  if d.id is null or d.status <> 'committed' then
    return cs2.err('draw_state', jsonb_build_object('status', coalesce(d.status, 'none')));
  end if;
  if v_raw !~ '^[0-9a-fA-F]{64}$' then
    return cs2.validation(jsonb_build_array(cs2.verr('secret', 'invalid')));
  end if;
  if cs2.sha256_hex(v_raw) = d.commit_hash then
    v_secret := v_raw;
  elsif cs2.sha256_hex(lower(v_raw)) = d.commit_hash then
    v_secret := lower(v_raw);
  else
    perform cs2.audit(p_actor, 'draw_bad_commit', null, null, jsonb_build_object('draw_id', d.id));
    return cs2.err('bad_commit');
  end if;
  if coalesce(jsonb_typeof(p_args -> 'inputs'), '') <> 'object' then
    return cs2.validation(jsonb_build_array(cs2.verr('inputs', 'invalid')));
  end if;
  for v_code in select t.code from cs2.teams t where not t.is_hidden order by t.id loop
    v_txt := case when jsonb_typeof(p_args -> 'inputs' -> v_code) in ('number', 'string')
                  then btrim(p_args -> 'inputs' ->> v_code) end;
    if v_txt is null or v_txt = '' then
      v_errs := v_errs || jsonb_build_array(cs2.verr('inputs.' || v_code, 'required'));
    elsif v_txt !~ '^[0-9]{1,4}$' then
      v_errs := v_errs || jsonb_build_array(cs2.verr('inputs.' || v_code, 'invalid'));
    else
      v_inputs := v_inputs || jsonb_build_object(v_code, v_txt::integer);
    end if;
  end loop;
  if jsonb_array_length(v_errs) > 0 then
    return cs2.validation(v_errs);
  end if;
  v_res := cs2.draw_compute_groups(v_secret, v_inputs);
  update cs2.draws
     set status = 'computed', secret = v_secret, inputs = v_inputs, inputs_str = v_res ->> 'inputs',
         seed = v_res ->> 'seed', keys = v_res -> 'keys', groups = v_res -> 'groups', computed_at = now()
   where id = d.id;
  perform cs2.bump_version();
  perform cs2.audit(p_actor, 'draw_compute', null, null, jsonb_build_object('draw_id', d.id, 'seed', v_res ->> 'seed'));
  return jsonb_build_object('ok', true, 'draw', cs2.draw_json(true));
end $$;

-- draw_publish {} — once; writes seats
create or replace function cs2.adm_draw_publish(p_actor text, p_args jsonb) returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  d cs2.draws;
begin
  perform 1 from cs2.settings where id = 1 for update;
  select * into d from cs2.draws where status <> 'void' for update;
  if d.id is null or d.status <> 'computed' then
    return cs2.err('draw_state', jsonb_build_object('status', coalesce(d.status, 'none')));
  end if;
  perform cs2.draw_apply_seats(d.groups);
  update cs2.draws set status = 'published', published_at = now() where id = d.id;
  perform cs2.bump_version();
  perform cs2.audit(p_actor, 'draw_publish', null, null, jsonb_build_object('draw_id', d.id, 'seed', d.seed));
  return jsonb_build_object('ok', true, 'draw', cs2.draw_json(true));
end $$;

-- draw_void {reason} — only while no group match has started/been reported
create or replace function cs2.adm_draw_void(p_actor text, p_args jsonb) returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  d        cs2.draws;
  v_reason text := left(cs2.norm_text(p_args ->> 'reason'), 300);
begin
  if v_reason is null then
    return cs2.validation(jsonb_build_array(cs2.verr('reason', 'required')));
  end if;
  perform 1 from cs2.settings where id = 1 for update;
  select * into d from cs2.draws where status <> 'void' for update;
  if d.id is null then
    return cs2.err('draw_state', jsonb_build_object('status', 'none'));
  end if;
  if exists (select 1 from cs2.matches where stage = 'group' and status <> 'scheduled') then
    return cs2.err('draw_state', jsonb_build_object('status', d.status, 'reason', 'matches_started'));
  end if;
  update cs2.draws set status = 'void', voided_at = now(), void_reason = v_reason where id = d.id;
  if d.status = 'published' then
    perform cs2.draw_clear_seats();
  end if;
  perform cs2.bump_version();
  perform cs2.audit(p_actor, 'draw_void', null, null,
                    jsonb_build_object('draw_id', d.id, 'was', d.status, 'reason', v_reason));
  return jsonb_build_object('ok', true, 'draw', cs2.draw_json(true));
end $$;

-- draw_manual {groups:{A:[code×3],…}, reason} — physical-lot fallback, published directly
create or replace function cs2.adm_draw_manual(p_actor text, p_args jsonb) returns jsonb
language plpgsql volatile set search_path = ''
as $$
declare
  d        cs2.draws;
  v_reason text := left(cs2.norm_text(p_args ->> 'reason'), 300);
  v_errs   jsonb;
  v_groups jsonb;
  v_id     bigint;
begin
  if v_reason is null then
    return cs2.validation(jsonb_build_array(cs2.verr('reason', 'required')));
  end if;
  v_errs := cs2.draw_groups_errors(p_args -> 'groups');
  if jsonb_array_length(v_errs) > 0 then
    return cs2.validation(v_errs);
  end if;
  v_groups := jsonb_build_object('A', p_args -> 'groups' -> 'A', 'B', p_args -> 'groups' -> 'B',
                                 'V', p_args -> 'groups' -> 'V', 'G', p_args -> 'groups' -> 'G');
  perform 1 from cs2.settings where id = 1 for update;
  select * into d from cs2.draws where status <> 'void' for update;
  if d.id is not null and d.status = 'published' then
    return cs2.err('draw_state', jsonb_build_object('status', d.status));
  end if;
  if d.id is not null then
    update cs2.draws set status = 'void', voided_at = now(),
           void_reason = left('Гар сугалаагаар солив: ' || v_reason, 300)
     where id = d.id;
  end if;
  insert into cs2.draws (status, method, groups, reason, published_at)
  values ('published', 'manual', v_groups, v_reason, now())
  returning id into v_id;
  perform cs2.draw_apply_seats(v_groups);
  perform cs2.bump_version();
  perform cs2.audit(p_actor, 'draw_manual', null, null,
                    jsonb_build_object('draw_id', v_id, 'replaced', d.id, 'reason', v_reason));
  return jsonb_build_object('ok', true, 'draw', cs2.draw_json(true));
end $$;

revoke all on all functions in schema cs2 from public, anon, authenticated;

-- CONTRACT §3 test vector (the migration fails if the SQL draw ever disagrees with logic.js)
do $$
declare
  r jsonb;
begin
  r := cs2.draw_compute_groups(
         '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
         '{"12a":1234,"11a":5,"11b":987,"teachers":42,"10a":0,"10b":9999,"10v":313,"9a":777,"9b":2024,"8a":8,"8b":55,"8v":1001}');
  assert r ->> 'inputs' = '12a=1234,11a=5,11b=987,teachers=42,10a=0,10b=9999,10v=313,9a=777,9b=2024,8a=8,8b=55,8v=1001',
         'draw inputs string mismatch';
  assert r ->> 'seed' = '362b441a74ad4f47eb6726b0238f078c114ca567640a5b96ea517dfa3f7d5798', 'draw seed mismatch';
  assert r -> 'groups' = '{"A":["teachers","9a","9b"],"B":["12a","10b","8v"],"V":["11b","10a","8a"],"G":["11a","10v","8b"]}'::jsonb,
         'draw groups mismatch';
end $$;
