-- 07_grants.sql — privileges (CONTRACT §0/§4/§8): anon/authenticated cannot touch any cs2 table or helper,
-- only the ten public.cs2_* SECURITY INVOKER wrappers are the API, cs2_api functions are SECURITY DEFINER with
-- search_path = '', RLS on with a deny-all policy, and other apps' privileges equal the 2026-10-13 baseline.
-- Read-only except for SET ROLE inside the transaction; rolled back.
begin;

do $$
declare
  r     record;
  v     jsonb;
  ok    boolean;
  n     integer;
  h     text;
  roles text[] := array['anon', 'authenticated'];
  ro    text;
begin
  -- 1. schemas
  foreach ro in array roles loop
    assert not has_schema_privilege(ro, 'cs2', 'USAGE') and not has_schema_privilege(ro, 'cs2', 'CREATE'), ro || ': no access to schema cs2';
    assert has_schema_privilege(ro, 'cs2_api', 'USAGE') and not has_schema_privilege(ro, 'cs2_api', 'CREATE'), ro || ': cs2_api usage only';
  end loop;

  -- 2. tables, sequences: nothing for anon/authenticated/PUBLIC; RLS on + deny-all policy
  for r in select c.oid, c.relname, c.relkind, c.relacl, c.relrowsecurity
             from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname in ('cs2', 'cs2_api') and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f') loop
    foreach ro in array roles loop
      if r.relkind = 'S' then
        assert not has_sequence_privilege(ro, r.oid, 'USAGE') and not has_sequence_privilege(ro, r.oid, 'SELECT')
               and not has_sequence_privilege(ro, r.oid, 'UPDATE'), ro || ' has a privilege on sequence ' || r.relname;
      else
        assert not has_table_privilege(ro, r.oid, 'SELECT') and not has_table_privilege(ro, r.oid, 'INSERT')
               and not has_table_privilege(ro, r.oid, 'UPDATE') and not has_table_privilege(ro, r.oid, 'DELETE')
               and not has_table_privilege(ro, r.oid, 'TRUNCATE') and not has_any_column_privilege(ro, r.oid, 'SELECT'),
               ro || ' has a privilege on table ' || r.relname;
      end if;
    end loop;
    assert not exists (select 1 from aclexplode(coalesce(r.relacl, '{}'::aclitem[])) a where a.grantee <> 'postgres'::regrole),
           'only the owner is in the ACL of ' || r.relname;
    if r.relkind = 'r' then
      assert r.relrowsecurity, 'RLS off on ' || r.relname;
      assert exists (select 1 from pg_policy p where p.polrelid = r.oid and p.polname = 'cs2_deny_all' and not p.polpermissive),
             'deny-all policy missing on ' || r.relname;
    end if;
  end loop;
  assert (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'cs2' and c.relkind = 'r') = 13,
         '13 cs2 tables';
  assert not exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'cs2_api' and c.relkind <> 'i'),
         'cs2_api holds functions only';

  -- 3. cs2 helpers: not executable by anyone but the owner; search_path pinned
  for r in select p.oid, p.proname, p.proconfig, p.proacl, p.prosecdef from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname = 'cs2' loop
    assert not has_function_privilege('anon', r.oid, 'EXECUTE') and not has_function_privilege('authenticated', r.oid, 'EXECUTE'),
           'cs2 helper executable: ' || r.proname;
    assert r.proacl is not null and not exists (select 1 from aclexplode(r.proacl) a where a.grantee = 0), 'PUBLIC execute: ' || r.proname;
    assert r.proconfig @> array['search_path=""'] and not r.prosecdef, 'helper search_path / definer: ' || r.proname;
  end loop;

  -- 4. cs2_api: SECURITY DEFINER, search_path '', no PUBLIC execute (anon/authenticated only for the wrappers)
  for r in select p.oid, p.proname, p.proconfig, p.proacl, p.prosecdef from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname = 'cs2_api' loop
    assert r.prosecdef and r.proconfig @> array['search_path=""'], 'cs2_api definer + search_path: ' || r.proname;
    assert r.proacl is not null and not exists (select 1 from aclexplode(r.proacl) a where a.grantee = 0), 'PUBLIC execute: ' || r.proname;
  end loop;
  assert (select array_agg(p.proname::text order by p.proname::text collate "C") from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'cs2_api')
         = array['admin', 'admin_login', 'admin_logout', 'admin_setup', 'class_confirm', 'class_get', 'class_save', 'public_state',
                 'ref_get', 'ref_report'], 'cs2_api function set';

  -- 5. public wrappers: exactly the CONTRACT signatures, SECURITY INVOKER, search_path ''
  assert (select array_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' order by p.proname::text collate "C")
            from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'cs2\_%')
         = array['cs2_admin(p_session text, p_action text, p_args jsonb)',
                 'cs2_admin_login(p_label text, p_secret text)',
                 'cs2_admin_logout(p_session text)',
                 'cs2_admin_setup(p_code text, p_label text, p_secret text)',
                 'cs2_class_confirm(p_token text, p_pin text, p_attest jsonb)',
                 'cs2_class_get(p_token text)',
                 'cs2_class_save(p_token text, p_payload jsonb)',
                 'cs2_public_state(p_version bigint)',
                 'cs2_ref_get(p_token text)',
                 'cs2_ref_report(p_token text, p_no integer, p_action text, p_score_a integer, p_score_b integer, p_forfeit text, p_team_a integer, p_team_b integer)'],
         'public.cs2_* signatures';
  for r in select p.oid, p.proname, p.proconfig, p.proacl, p.prosecdef, p.pronargdefaults
             from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'cs2\_%' loop
    assert not r.prosecdef and r.proconfig @> array['search_path=""'], 'wrapper invoker + search_path: ' || r.proname;
    assert has_function_privilege('anon', r.oid, 'EXECUTE') and has_function_privilege('authenticated', r.oid, 'EXECUTE'),
           'wrapper executable: ' || r.proname;
    assert not exists (select 1 from aclexplode(r.proacl) a where a.grantee = 0), 'PUBLIC execute on wrapper: ' || r.proname;
    assert r.pronargdefaults = case r.proname when 'cs2_public_state' then 1 when 'cs2_ref_report' then 5 when 'cs2_admin' then 1 else 0 end,
           'defaults: ' || r.proname;
  end loop;

  -- 6. behave as the publishable key does (role anon)
  set local role anon;
  begin
    perform 1 from cs2.teams limit 1;
    ok := false;
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'anon could SELECT cs2.teams';
  begin
    perform 1 from cs2.players limit 1;
    ok := false;
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'anon could SELECT cs2.players';
  begin
    update cs2.settings set version = version where id = 1;
    ok := false;
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'anon could UPDATE cs2.settings';
  begin
    perform cs2.sha256_hex('x');
    ok := false;
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'anon could execute a cs2 helper';
  v := public.cs2_public_state(null);
  assert (v ->> 'ok')::boolean and jsonb_array_length(v -> 'teams') = 12, 'anon: public state through the wrapper';
  assert public.cs2_class_get('no-such-token-000000000000') ->> 'error' = 'bad_token', 'anon: class_get wrapper';
  assert public.cs2_admin('no-such-session-0000000000', 'overview', '{}') ->> 'error' = 'bad_session', 'anon: admin wrapper';
  assert public.cs2_ref_get('no-such-token-000000000000') ->> 'error' = 'bad_token', 'anon: ref_get wrapper';
  reset role;

  set local role authenticated;
  begin
    perform 1 from cs2.admins limit 1;
    ok := false;
  exception when insufficient_privilege then ok := true;
  end;
  reset role;
  assert ok, 'authenticated could SELECT cs2.admins';

  -- 7. other apps' privileges for anon/authenticated/PUBLIC = the baseline taken before cs2_01 (2026-10-13 08:31 UTC).
  --    A mismatch here means some object OUTSIDE cs2 changed its grants (this portal never grants outside cs2/cs2_api).
  with objs as (
    select 'schema'::text kind, s.nspname::text sch, s.nspname::text obj, coalesce(s.nspacl, acldefault('n', s.nspowner)) acl
      from pg_namespace s where s.nspname not in ('cs2', 'cs2_api') and s.nspname not like 'pg\_temp%' and s.nspname not like 'pg\_toast\_temp%'
    union all
    select 'rel:' || c.relkind::text, s.nspname::text, c.relname::text,
           coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 's' else 'r' end::"char", c.relowner))
      from pg_class c join pg_namespace s on s.oid = c.relnamespace
     where s.nspname not in ('cs2', 'cs2_api') and s.nspname not like 'pg\_temp%' and s.nspname not like 'pg\_toast\_temp%'
       and c.relkind in ('r', 'v', 'm', 'S', 'f', 'p')
    union all
    select 'col', s.nspname::text, c.relname || '.' || a.attname, a.attacl
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace s on s.oid = c.relnamespace
     where a.attacl is not null and s.nspname not in ('cs2', 'cs2_api') and s.nspname not like 'pg\_temp%'
    union all
    select 'func', s.nspname::text, p.oid::regprocedure::text, coalesce(p.proacl, acldefault('f', p.proowner))
      from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname not in ('cs2', 'cs2_api') and not (s.nspname = 'public' and p.proname like 'cs2\_%')
    union all
    select 'defacl', coalesce(s.nspname::text, '<global>'), d.defaclrole::regrole::text || ':' || d.defaclobjtype::text, d.defaclacl
      from pg_default_acl d left join pg_namespace s on s.oid = d.defaclnamespace
     where coalesce(s.nspname::text, '') not in ('cs2', 'cs2_api')
  ), ex as (
    select o.kind, o.sch, o.obj, case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end grantee,
           a.privilege_type, a.is_grantable
      from objs o cross join lateral aclexplode(o.acl) a
     where a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole)
  )
  select count(*), md5(string_agg(kind || '|' || sch || '|' || obj || '|' || grantee || '|' || privilege_type || '|' || is_grantable::text,
                                  E'\n' order by kind, sch, obj, grantee, privilege_type))
    into n, h from ex;
  assert n = 3932 and h = '5bc531af42cb7779efc4a7ffcdfcba91',
         format('non-cs2 privileges differ from the baseline (n=%s h=%s, baseline n=3932 h=5bc531af42cb7779efc4a7ffcdfcba91)', n, h);
end $$;

rollback;
select 'PASS 07_grants' as result;
