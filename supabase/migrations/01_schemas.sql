-- cs2_01_schemas — «Ангийн аварга – CS2 2026»
-- The Supabase project is shared with other apps: everything of this portal lives in
--   cs2      private tables + internal helper functions (no access for anon/authenticated)
--   cs2_api  SECURITY DEFINER API functions (called only through thin public.cs2_* wrappers)
-- Nothing outside cs2, cs2_api and public.cs2_* is created, altered or granted.

create schema if not exists cs2;
create schema if not exists cs2_api;

comment on schema cs2 is 'Ангийн аварга – CS2 2026: private tables and helpers (no API access).';
comment on schema cs2_api is 'Ангийн аварга – CS2 2026: SECURITY DEFINER API, called via public.cs2_* wrappers.';

-- cs2: owner only.
revoke all on schema cs2 from public;
revoke all on schema cs2 from anon, authenticated;

-- cs2_api: USAGE only, so that the SECURITY INVOKER wrappers can reach the API functions.
revoke all on schema cs2_api from public;
grant usage on schema cs2_api to anon, authenticated;

-- New objects in these schemas are not granted to anyone by default
-- (functions still get the built-in PUBLIC EXECUTE, which every migration revokes explicitly).
alter default privileges for role postgres in schema cs2 revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema cs2 revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema cs2 revoke all on functions from public, anon, authenticated;
alter default privileges for role postgres in schema cs2_api revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema cs2_api revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema cs2_api revoke all on functions from public;
